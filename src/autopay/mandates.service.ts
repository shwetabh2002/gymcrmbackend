import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  PaymentMandate,
  PaymentMandateDocument,
} from '../checkout/schemas/payment-mandate.schema';
import {
  MemberSubscription,
  MemberSubscriptionDocument,
} from '../member-subscriptions/schemas/member-subscription.schema';
import { MemberSubscriptionsService } from '../member-subscriptions/member-subscriptions.service';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  BillingMode,
  MandateStatus,
  PaymentSource,
} from '../common/enums/billing.enum';
import { PaymentMode } from '../common/enums/payment-mode.enum';
import { RenewalFollowUpStatus } from '../common/enums/renewal-follow-up-status.enum';
import { PaymentsService } from '../payments/payments.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { PaymentProviderService } from '../payment-provider/payment-provider.service';
import { RazorpayApiService } from '../payment-provider/razorpay-api.service';
import {
  DOUBLE_CHARGE_WINDOW_MS,
  MAX_CONSECUTIVE_FAILURES,
  PENDING_CHARGE_TIMEOUT_MS,
} from '../config/autopay.config';
import { toIsoDate } from '../config/time.constants';
import { CHARGE_KINDS, ChargeKind } from '../config/payment-notes.config';
import { EmailTemplatesService } from '../email/email-templates.service';
import { EMAIL_TYPES } from '../config/email-templates.config';
import { CompanyContextService } from '../common/company-context/company-context.service';

export type ChargeIntent = {
  /** dues collects the outstanding balance, renewal starts a new cycle. */
  kind: Extract<ChargeKind, 'DUES' | 'RENEWAL'>;
  amount: number;
};

/** Ledger note text, so the same charge always reads the same in the UI. */
export const AUTOPAY_LEDGER_NOTES = {
  renewal: 'Autopay renewal',
  dues: 'Autopay dues collection',
} as const;

/**
 * Everything about a mandate's life after it is created: deciding what is owed,
 * applying a confirmed debit, reacting to webhooks, and cancelling.
 *
 * Shared by the hourly worker and the Razorpay webhook so a charge that Razorpay
 * confirms asynchronously lands in the ledger exactly once.
 */
@Injectable()
export class MandatesService {
  private readonly logger = new Logger(MandatesService.name);

  constructor(
    @InjectModel(PaymentMandate.name)
    private mandateModel: Model<PaymentMandateDocument>,
    @InjectModel(MemberSubscription.name)
    private subModel: Model<MemberSubscriptionDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private payments: PaymentsService,
    private subscriptions: MemberSubscriptionsService,
    private whatsapp: WhatsAppService,
    private paymentProvider: PaymentProviderService,
    private razorpay: RazorpayApiService,
    private emailTemplates: EmailTemplatesService,
    private companyContext: CompanyContextService,
  ) {}

  // ───────────────────────── What to charge ─────────────────────────

  /**
   * Dues first, renewal only when the cycle is fully paid and expired.
   * Returns null when nothing is owed right now.
   */
  resolveIntent(
    sub: MemberSubscriptionDocument,
    now: Date,
  ): ChargeIntent | null {
    const pending = Number(sub.pendingAmount) || 0;
    if (pending > 0) return { kind: CHARGE_KINDS.dues, amount: pending };

    if (sub.expiryDate && sub.expiryDate.getTime() <= now.getTime()) {
      const price = Number(sub.planPrice) || 0;
      if (price > 0) return { kind: CHARGE_KINDS.renewal, amount: price };
    }
    return null;
  }

  /**
   * Razorpay customer to charge against.
   *
   * Mandates created before the customer id was stored on the mandate fall back
   * to the member's — without this, every pre-existing mandate would be blocked
   * forever and stop renewing silently.
   */
  effectiveCustomerId(
    mandate: PaymentMandateDocument,
    memberRzpCustomerId?: string | null,
  ): string {
    return (mandate.customerId || memberRzpCustomerId || '').trim();
  }

  /**
   * Reasons this mandate cannot be debited right now. Empty array = go ahead.
   */
  blockers(
    mandate: PaymentMandateDocument,
    amount: number,
    now: Date,
    memberRzpCustomerId?: string | null,
  ): string[] {
    const reasons: string[] = [];

    if (mandate.status !== MandateStatus.ACTIVE) {
      reasons.push(`mandate is ${mandate.status}`);
    }
    if (!mandate.tokenId) reasons.push('mandate has no token');
    if (!this.effectiveCustomerId(mandate, memberRzpCustomerId)) {
      reasons.push('mandate has no Razorpay customer');
    }
    if (mandate.expireAt && mandate.expireAt.getTime() <= now.getTime()) {
      reasons.push('mandate expired — member must re-approve');
    }
    if (mandate.maxAmount != null && amount > mandate.maxAmount) {
      reasons.push(
        `amount ${amount} exceeds the approved per-debit limit of ${mandate.maxAmount}`,
      );
    }
    if (
      mandate.lastChargedAt &&
      now.getTime() - mandate.lastChargedAt.getTime() < DOUBLE_CHARGE_WINDOW_MS
    ) {
      reasons.push('charged within the last 20 hours');
    }
    if (
      mandate.pendingPaymentId &&
      mandate.pendingSince &&
      now.getTime() - mandate.pendingSince.getTime() < PENDING_CHARGE_TIMEOUT_MS
    ) {
      reasons.push(
        `waiting on Razorpay to confirm ${mandate.pendingPaymentId}`,
      );
    }
    if ((mandate.consecutiveFailures || 0) >= MAX_CONSECUTIVE_FAILURES) {
      reasons.push(
        `paused after ${mandate.consecutiveFailures} consecutive failures`,
      );
    }

    return reasons;
  }

  // ───────────────────────── Charge bookkeeping ─────────────────────────

  /** Razorpay accepted the charge but has not confirmed capture yet. */
  async markChargePending(
    mandate: PaymentMandateDocument,
    paymentId: string,
    amount: number,
    now: Date,
  ) {
    mandate.pendingPaymentId = paymentId;
    mandate.pendingAmount = amount;
    mandate.pendingSince = now;
    mandate.lastChargedAt = now;
    await mandate.save();
  }

  /**
   * A debit is confirmed captured — write it to the ledger (which also creates
   * the invoice) and, for a renewal, roll the subscription into its next cycle.
   *
   * Idempotent on `providerRef`: the worker and the webhook can both call this
   * for the same payment and only one ledger row appears.
   */
  async applyCapturedCharge(input: {
    companyId: string;
    subscriptionId: string;
    mandate: PaymentMandateDocument;
    amount: number;
    providerRef: string;
    kind: ChargeIntent['kind'];
  }): Promise<{ applied: boolean; paymentId?: string; reason?: string }> {
    const existing = await this.payments.findByProviderRef(
      input.companyId,
      input.providerRef,
    );
    if (existing) {
      await this.clearPending(input.mandate, input.providerRef);
      return {
        applied: false,
        paymentId: String(existing._id),
        reason: 'already_recorded',
      };
    }

    const found = await this.subModel
      .findOne({ _id: input.subscriptionId, companyId: input.companyId })
      .exec();
    if (!found) {
      return { applied: false, reason: 'subscription_missing' };
    }

    // A renewal must open the next cycle BEFORE the payment is applied, so the
    // money lands against the new cycle's price instead of the finished one.
    const sub: MemberSubscriptionDocument =
      input.kind === 'RENEWAL'
        ? await this.subscriptions.startNewCycle(
            input.companyId,
            String(found._id),
          )
        : found;

    const member = await this.userModel.findById(sub.memberId).exec();
    const receivedById =
      member?.salesPersonId?.toString() || String(sub.memberId);

    const payment = await this.payments.createFromProvider({
      companyId: input.companyId,
      locationId: String(sub.locationId),
      memberId: String(sub.memberId),
      subscriptionId: String(sub._id),
      amount: input.amount,
      paymentMode: PaymentMode.ONLINE,
      paymentDate: toIsoDate(new Date()),
      providerRef: input.providerRef,
      source: PaymentSource.AUTOPAY,
      receivedById,
      notes:
        input.kind === CHARGE_KINDS.renewal
          ? AUTOPAY_LEDGER_NOTES.renewal
          : AUTOPAY_LEDGER_NOTES.dues,
    });

    if (input.kind === CHARGE_KINDS.renewal) {
      sub.renewalFollowUpStatus = RenewalFollowUpStatus.RENEWED;
      await sub.save();
      input.mandate.nextChargeAt = sub.expiryDate;
    }

    input.mandate.consecutiveFailures = 0;
    input.mandate.lastFailureReason = null;
    await this.clearPending(input.mandate, input.providerRef);

    return { applied: true, paymentId: String(payment._id) };
  }

  private async clearPending(
    mandate: PaymentMandateDocument,
    paymentId?: string,
  ) {
    if (!paymentId || mandate.pendingPaymentId === paymentId) {
      mandate.pendingPaymentId = null;
      mandate.pendingAmount = null;
      mandate.pendingSince = null;
    }
    await mandate.save();
  }

  /** A debit failed — record why, tell the member, queue a follow-up. */
  async recordFailure(input: {
    companyId: string;
    mandate: PaymentMandateDocument;
    subscriptionId?: string | null;
    amount: number;
    reason: string;
    notifyMember?: boolean;
  }) {
    const mandate = input.mandate;
    mandate.lastFailureReason = input.reason;
    mandate.consecutiveFailures = (mandate.consecutiveFailures || 0) + 1;
    mandate.pendingPaymentId = null;
    mandate.pendingAmount = null;
    mandate.pendingSince = null;
    if (mandate.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      mandate.status = MandateStatus.PAUSED;
      this.logger.warn(
        `Mandate ${mandate._id} paused after ${mandate.consecutiveFailures} failures`,
      );
    }
    await mandate.save();

    const subId = input.subscriptionId || mandate.subscriptionId;
    if (subId) {
      await this.subModel
        .updateOne(
          { _id: subId, companyId: input.companyId },
          { renewalFollowUpStatus: RenewalFollowUpStatus.PENDING },
        )
        .exec();
    }

    if (input.notifyMember !== false) {
      const member = await this.userModel.findById(mandate.memberId).exec();

      void this.emailTemplates
        .sendTemplated({
          companyId: input.companyId,
          type: EMAIL_TYPES.autopayFailed,
          to: member?.email,
          vars: {
            memberName: member?.name || 'there',
            amount: await this.companyContext.formatMoney(
              input.companyId,
              input.amount,
            ),
            reason: input.reason,
          },
        })
        .catch(() => undefined);

      if (member?.phone) {
        await this.whatsapp
          .sendPaymentFailedNotice({
            companyId: input.companyId,
            phone: member.phone,
            memberName: member.name,
            amount: input.amount,
          })
          .catch(() => undefined);
      }
    }
  }

  // ───────────────────────── Webhook entry points ─────────────────────────

  /** payment.captured with notes.source=AUTOPAY — the async half of a charge. */
  async handleAutopayCapture(input: {
    companyId: string;
    paymentId: string;
    amount: number;
    tokenId?: string | null;
    subscriptionId?: string | null;
    kind?: string | null;
  }) {
    const mandate = await this.findMandate(
      input.companyId,
      input.tokenId,
      input.subscriptionId,
    );
    if (!mandate) {
      this.logger.warn(
        `Autopay capture ${input.paymentId} has no matching mandate — ignored`,
      );
      return { ok: false, reason: 'mandate_not_found' };
    }

    const subscriptionId =
      input.subscriptionId ||
      (mandate.subscriptionId ? String(mandate.subscriptionId) : null);
    if (!subscriptionId) {
      return { ok: false, reason: 'subscription_unknown' };
    }

    const amount =
      input.amount > 0 ? input.amount : Number(mandate.pendingAmount) || 0;
    if (amount <= 0) return { ok: false, reason: 'amount_unknown' };

    const result = await this.applyCapturedCharge({
      companyId: input.companyId,
      subscriptionId,
      mandate,
      amount,
      providerRef: input.paymentId,
      kind:
        input.kind === CHARGE_KINDS.renewal
          ? CHARGE_KINDS.renewal
          : CHARGE_KINDS.dues,
    });
    return { ok: true, ...result };
  }

  /** payment.failed with notes.source=AUTOPAY. */
  async handleAutopayFailure(input: {
    companyId: string;
    paymentId: string;
    amount: number;
    reason: string;
    tokenId?: string | null;
    subscriptionId?: string | null;
  }) {
    const mandate = await this.findMandate(
      input.companyId,
      input.tokenId,
      input.subscriptionId,
    );
    if (!mandate) return { ok: false, reason: 'mandate_not_found' };

    await this.recordFailure({
      companyId: input.companyId,
      mandate,
      subscriptionId: input.subscriptionId,
      amount: input.amount || Number(mandate.pendingAmount) || 0,
      reason: input.reason,
    });
    return { ok: true };
  }

  /** token.confirmed / token.paused / token.cancelled / token.rejected. */
  async updateStatusFromToken(input: {
    companyId: string;
    tokenId: string;
    status: MandateStatus;
    reason?: string | null;
  }) {
    const mandate = await this.mandateModel
      .findOne({ companyId: input.companyId, tokenId: input.tokenId })
      .exec();
    if (!mandate) return { ok: false, reason: 'mandate_not_found' };

    mandate.status = input.status;
    if (input.reason !== undefined) {
      mandate.lastFailureReason = input.reason;
    }
    if (input.status === MandateStatus.ACTIVE) {
      mandate.consecutiveFailures = 0;
      mandate.lastFailureReason = null;
    }
    await mandate.save();

    // A dead mandate must not leave the subscription pretending to be automatic.
    const dead =
      input.status === MandateStatus.CANCELLED ||
      input.status === MandateStatus.REJECTED;
    if (dead && mandate.subscriptionId) {
      await this.subModel
        .updateOne(
          { _id: mandate.subscriptionId, companyId: input.companyId },
          { billingMode: BillingMode.MANUAL },
        )
        .exec();
    }

    this.logger.log(
      `Mandate ${mandate._id} → ${input.status}${input.reason ? ` (${input.reason})` : ''}`,
    );
    return { ok: true, mandateId: String(mandate._id) };
  }

  private async findMandate(
    companyId: string,
    tokenId?: string | null,
    subscriptionId?: string | null,
  ): Promise<PaymentMandateDocument | null> {
    if (tokenId) {
      const byToken = await this.mandateModel
        .findOne({ companyId, tokenId })
        .exec();
      if (byToken) return byToken;
    }
    if (subscriptionId) {
      return this.mandateModel.findOne({ companyId, subscriptionId }).exec();
    }
    return null;
  }

  // ───────────────────────── Staff actions ─────────────────────────

  /** Cancel a mandate at Razorpay and put the subscription back on manual. */
  async cancelMandate(companyId: string, subscriptionId: string) {
    const sub = await this.subModel
      .findOne({ _id: subscriptionId, companyId })
      .exec();
    if (!sub) throw new NotFoundException('Subscription not found');
    if (!sub.mandateId) {
      throw new NotFoundException('This subscription has no autopay mandate');
    }

    const mandate = await this.mandateModel
      .findOne({ _id: sub.mandateId, companyId })
      .exec();
    if (!mandate) throw new NotFoundException('Mandate not found');

    let providerCancelled = false;
    try {
      const creds = await this.paymentProvider.getCredentials(companyId);
      providerCancelled = await this.razorpay.cancelToken(
        creds,
        mandate.customerId || '',
        mandate.tokenId,
      );
    } catch (err) {
      // Local state must still reflect intent even if Razorpay rejects the call.
      this.logger.warn(
        `Razorpay token cancel failed for mandate ${mandate._id}: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }

    mandate.status = MandateStatus.CANCELLED;
    mandate.pendingPaymentId = null;
    mandate.pendingAmount = null;
    mandate.pendingSince = null;
    await mandate.save();

    sub.billingMode = BillingMode.MANUAL;
    await sub.save();

    return {
      ok: true,
      providerCancelled,
      mandateId: String(mandate._id),
      subscriptionId: String(sub._id),
      billingMode: sub.billingMode,
    };
  }

  async getMandateForSubscription(companyId: string, subscriptionId: string) {
    const mandate = await this.mandateModel
      .findOne({ companyId, subscriptionId })
      .lean()
      .exec();
    if (!mandate) return null;
    return {
      id: String(mandate._id),
      status: mandate.status,
      method: mandate.method,
      maxAmount: mandate.maxAmount,
      expireAt: mandate.expireAt,
      lastChargedAt: mandate.lastChargedAt,
      nextChargeAt: mandate.nextChargeAt,
      lastFailureReason: mandate.lastFailureReason,
      consecutiveFailures: mandate.consecutiveFailures || 0,
      awaitingConfirmation: !!mandate.pendingPaymentId,
    };
  }
}
