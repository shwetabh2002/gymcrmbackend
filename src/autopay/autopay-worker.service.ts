import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  MemberSubscription,
  MemberSubscriptionDocument,
} from '../member-subscriptions/schemas/member-subscription.schema';
import {
  PaymentMandate,
  PaymentMandateDocument,
} from '../checkout/schemas/payment-mandate.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { BillingMode, MandateStatus } from '../common/enums/billing.enum';
import { SubscriptionStatus } from '../common/enums/subscription-status.enum';
import { PaymentProviderService } from '../payment-provider/payment-provider.service';
import { RazorpayApiService } from '../payment-provider/razorpay-api.service';
import { ConfigService } from '@nestjs/config';
import { GymSettingsService } from '../gym-settings/gym-settings.service';
import { RuntimeService } from '../common/runtime/runtime.service';
import { MandatesService } from './mandates.service';
import {
  AUTOPAY_BATCH_SIZE,
  AUTOPAY_MAX_ROUNDS,
  DEFAULT_AUTOPAY_INTERVAL_MS,
} from '../config/autopay.config';
import {
  RAZORPAY_PAYMENT_STATUS,
  toMinorUnits,
} from '../config/razorpay.config';
import {
  PAYMENT_NOTE_KEYS,
  PAYMENT_NOTE_SOURCE,
} from '../config/payment-notes.config';

export type AutopayRunSummary = {
  charged: number;
  pending: number;
  failed: number;
  skipped: number;
  examined: number;
  skippedReasons?: Record<string, number>;
};

@Injectable()
export class AutopayWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutopayWorkerService.name);
  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectModel(MemberSubscription.name)
    private subModel: Model<MemberSubscriptionDocument>,
    @InjectModel(PaymentMandate.name)
    private mandateModel: Model<PaymentMandateDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private paymentProvider: PaymentProviderService,
    private razorpay: RazorpayApiService,
    private config: ConfigService,
    private gymSettings: GymSettingsService,
    private mandates: MandatesService,
    private runtime: RuntimeService,
  ) {}

  onModuleInit() {
    if (this.config.get('AUTOPAY_WORKER_ENABLED') === 'false') {
      this.logger.log('Autopay worker disabled');
      return;
    }
    const ms =
      Number(this.config.get('AUTOPAY_WORKER_INTERVAL_MS')) ||
      DEFAULT_AUTOPAY_INTERVAL_MS;
    this.timer = setInterval(() => {
      void this.processDueCharges();
    }, ms);
    this.logger.log(`Autopay worker interval ${ms}ms`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * One sweep over everything an active mandate owes.
   * Also callable from POST /autopay/run for a manual run.
   */
  async processDueCharges(
    companyScope?: string,
  ): Promise<AutopayRunSummary & { alreadyRunning?: boolean }> {
    if (this.running) {
      return {
        charged: 0,
        pending: 0,
        failed: 0,
        skipped: 0,
        examined: 0,
        alreadyRunning: true,
      };
    }
    this.running = true;
    const now = new Date();
    const summary: AutopayRunSummary = {
      charged: 0,
      pending: 0,
      failed: 0,
      skipped: 0,
      examined: 0,
      skippedReasons: {},
    };

    try {
      const filter = {
        ...(companyScope ? { companyId: companyScope } : {}),
        billingMode: BillingMode.AUTOPAY,
        subscriptionStatus: {
          $in: [
            SubscriptionStatus.ACTIVE,
            SubscriptionStatus.EXPIRING_SOON,
            SubscriptionStatus.EXPIRED,
          ],
        },
        mandateId: { $ne: null },
        $or: [{ expiryDate: { $lte: now } }, { pendingAmount: { $gt: 0 } }],
      };

      /**
       * Paged so growth in gyms or members never leaves dues uncollected: a
       * single batch would silently stop at AUTOPAY_BATCH_SIZE and look
       * successful. Paging by _id keeps each query indexed and skip-free.
       */
      let cursorId: Types.ObjectId | null = null;
      let rounds = 0;
      while (rounds < AUTOPAY_MAX_ROUNDS) {
        rounds += 1;
        const due = await this.subModel
          .find(cursorId ? { ...filter, _id: { $gt: cursorId } } : filter)
          .sort({ _id: 1 })
          .limit(AUTOPAY_BATCH_SIZE)
          .exec();
        if (!due.length) break;
        cursorId = due[due.length - 1]._id as Types.ObjectId;
        summary.examined += due.length;

        for (const sub of due) {
          try {
            const companyId = String(sub.companyId);
            if (!(await this.gymSettings.isAutopayEnabled(companyId))) {
              this.note(summary, 'gym autopay is off');
              continue;
            }
            const outcome = await this.chargeOne(sub, now);
            if (outcome === 'charged') summary.charged += 1;
            else if (outcome === 'pending') summary.pending += 1;
            else if (outcome === 'failed') summary.failed += 1;
            else this.note(summary, outcome.reason);
          } catch (err) {
            summary.failed += 1;
            this.logger.warn(
              `Autopay failed for sub ${sub._id}: ${
                err instanceof Error ? err.message : err
              }`,
            );
          }
        }

        if (due.length < AUTOPAY_BATCH_SIZE) break;
      }

      if (rounds >= AUTOPAY_MAX_ROUNDS) {
        // Never let a full sweep look complete when it was cut short.
        this.logger.warn(
          `Autopay sweep hit the ${AUTOPAY_MAX_ROUNDS}-round cap — remaining dues wait for the next run`,
        );
      }

      this.logger.log(
        `Autopay worker: examined=${summary.examined} charged=${summary.charged} ` +
          `pending=${summary.pending} failed=${summary.failed} skipped=${summary.skipped}`,
      );
      return summary;
    } finally {
      this.running = false;
    }
  }

  private note(summary: AutopayRunSummary, reason: string) {
    summary.skipped += 1;
    const bucket = summary.skippedReasons!;
    bucket[reason] = (bucket[reason] || 0) + 1;
  }

  private async chargeOne(
    sub: MemberSubscriptionDocument,
    now: Date,
  ): Promise<'charged' | 'pending' | 'failed' | { reason: string }> {
    const companyId = String(sub.companyId);

    const mandate = await this.mandateModel
      .findOne({ _id: sub.mandateId, companyId })
      .exec();
    if (!mandate) return { reason: 'mandate row missing' };

    const intent = this.mandates.resolveIntent(sub, now);
    if (!intent) return { reason: 'nothing due' };

    const member = await this.userModel.findById(sub.memberId).exec();
    if (!member) return { reason: 'member missing' };

    const blockers = this.mandates.blockers(
      mandate,
      intent.amount,
      now,
      member.rzpCustomerId,
    );
    if (blockers.length) {
      // An expired or over-limit mandate needs the member, not a retry —
      // surface it on the subscription so staff can act.
      if (
        mandate.status === MandateStatus.ACTIVE &&
        blockers.some(
          (b) => b.includes('expired') || b.includes('exceeds the approved'),
        )
      ) {
        mandate.lastFailureReason = blockers[0];
        await mandate.save();
      }
      return { reason: blockers[0] };
    }

    const customerId = this.mandates.effectiveCustomerId(
      mandate,
      member.rzpCustomerId,
    );
    // Backfill legacy mandates so this fallback is needed only once.
    if (!mandate.customerId && customerId) {
      mandate.customerId = customerId;
      await mandate.save();
    }

    const creds = await this.paymentProvider.getCredentials(companyId);

    let result: { paymentId: string; orderId: string; status: string };
    try {
      result = await this.razorpay.chargeToken(creds, {
        amountPaise: toMinorUnits(intent.amount),
        tokenId: mandate.tokenId,
        customerId,
        receipt: `auto_${String(sub._id).slice(-8)}_${now.getTime()}`,
        email: member.email || this.runtime.systemEmail(),
        contact: member.phone || '',
        notes: {
          [PAYMENT_NOTE_KEYS.companyId]: companyId,
          [PAYMENT_NOTE_KEYS.subscriptionId]: String(sub._id),
          [PAYMENT_NOTE_KEYS.memberId]: String(sub.memberId),
          [PAYMENT_NOTE_KEYS.tokenId]: mandate.tokenId,
          [PAYMENT_NOTE_KEYS.source]: PAYMENT_NOTE_SOURCE.autopay,
          [PAYMENT_NOTE_KEYS.kind]: intent.kind,
        },
      });
    } catch (err) {
      await this.mandates.recordFailure({
        companyId,
        mandate,
        subscriptionId: String(sub._id),
        amount: intent.amount,
        reason: err instanceof Error ? err.message : String(err),
      });
      return 'failed';
    }

    if (result.status === RAZORPAY_PAYMENT_STATUS.failed) {
      await this.mandates.recordFailure({
        companyId,
        mandate,
        subscriptionId: String(sub._id),
        amount: intent.amount,
        reason: `Razorpay returned status=failed for ${result.paymentId}`,
      });
      return 'failed';
    }

    if (result.status !== RAZORPAY_PAYMENT_STATUS.captured) {
      // Razorpay accepted it; the payment.captured webhook finishes the job.
      await this.mandates.markChargePending(
        mandate,
        result.paymentId,
        intent.amount,
        now,
      );
      this.logger.log(
        `Autopay ${intent.kind} of ${intent.amount} for sub ${sub._id} awaiting capture (${result.paymentId})`,
      );
      return 'pending';
    }

    mandate.lastChargedAt = now;
    await mandate.save();

    const applied = await this.mandates.applyCapturedCharge({
      companyId,
      subscriptionId: String(sub._id),
      mandate,
      amount: intent.amount,
      providerRef: result.paymentId,
      kind: intent.kind,
    });

    return applied.applied
      ? 'charged'
      : { reason: applied.reason || 'not applied' };
  }
}
