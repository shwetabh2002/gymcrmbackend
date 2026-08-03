import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  MemberSubscription,
  MemberSubscriptionDocument,
} from '../member-subscriptions/schemas/member-subscription.schema';
import {
  PaymentMandate,
  PaymentMandateDocument,
} from '../checkout/schemas/payment-mandate.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { BillingMode, MandateStatus, PaymentSource } from '../common/enums/billing.enum';
import { SubscriptionStatus } from '../common/enums/subscription-status.enum';
import { PaymentMode } from '../common/enums/payment-mode.enum';
import { RenewalFollowUpStatus } from '../common/enums/renewal-follow-up-status.enum';
import { PaymentProviderService } from '../payment-provider/payment-provider.service';
import { RazorpayApiService } from '../payment-provider/razorpay-api.service';
import { PaymentsService } from '../payments/payments.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { ConfigService } from '@nestjs/config';
import { GymSettingsService } from '../gym-settings/gym-settings.service';

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
    private payments: PaymentsService,
    private whatsapp: WhatsAppService,
    private config: ConfigService,
    private gymSettings: GymSettingsService,
  ) {}

  onModuleInit() {
    if (this.config.get('AUTOPAY_WORKER_ENABLED') === 'false') {
      this.logger.log('Autopay worker disabled');
      return;
    }
    const ms = Number(this.config.get('AUTOPAY_WORKER_INTERVAL_MS') || 3_600_000);
    this.timer = setInterval(() => {
      void this.processDueCharges();
    }, ms);
    this.logger.log(`Autopay worker interval ${ms}ms`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Also callable via internal endpoint for manual runs */
  async processDueCharges() {
    if (this.running) return { skipped: true };
    this.running = true;
    const now = new Date();
    let charged = 0;
    let failed = 0;
    try {
      const due = await this.subModel
        .find({
          billingMode: BillingMode.AUTOPAY,
          subscriptionStatus: {
            $in: [
              SubscriptionStatus.ACTIVE,
              SubscriptionStatus.EXPIRING_SOON,
              SubscriptionStatus.EXPIRED,
            ],
          },
          mandateId: { $ne: null },
          $or: [
            { expiryDate: { $lte: now } },
            { pendingAmount: { $gt: 0 } },
          ],
        })
        .limit(100)
        .exec();

      for (const sub of due) {
        try {
          const companyId = String(sub.companyId);
          if (!(await this.gymSettings.isAutopayEnabled(companyId))) {
            continue;
          }
          const ok = await this.chargeOne(sub, now);
          if (ok) charged++;
          else failed++;
        } catch (err) {
          failed++;
          this.logger.warn(
            `Autopay failed for sub ${sub._id}: ${
              err instanceof Error ? err.message : err
            }`,
          );
        }
      }
      this.logger.log(`Autopay worker: charged=${charged} failed=${failed}`);
      return { charged, failed };
    } finally {
      this.running = false;
    }
  }

  private async chargeOne(
    sub: MemberSubscriptionDocument,
    now: Date,
  ): Promise<boolean> {
    const mandate = await this.mandateModel
      .findOne({
        _id: sub.mandateId,
        companyId: sub.companyId,
        status: MandateStatus.ACTIVE,
      })
      .exec();
    if (!mandate) return false;

    // Prefer collecting pending dues; if fully paid but expired, charge planPrice to renew
    let amount = Number(sub.pendingAmount) || 0;
    const renew = sub.expiryDate <= now && amount <= 0;
    if (renew) amount = Number(sub.planPrice) || 0;
    if (amount <= 0) return false;

    // Avoid double-charge within 20 hours
    if (
      mandate.lastChargedAt &&
      now.getTime() - mandate.lastChargedAt.getTime() < 20 * 60 * 60 * 1000
    ) {
      return false;
    }

    const companyId = String(sub.companyId);
    const creds = await this.paymentProvider.getCredentials(companyId);
    const member = await this.userModel.findById(sub.memberId).exec();

    try {
      const result = await this.razorpay.chargeToken(creds, {
        amountPaise: Math.round(amount * 100),
        tokenId: mandate.tokenId,
        customerId: member?.rzpCustomerId || undefined,
        receipt: `auto_${String(sub._id).slice(-8)}_${now.getTime()}`,
        notes: {
          companyId,
          subscriptionId: String(sub._id),
          memberId: String(sub.memberId),
          source: 'AUTOPAY',
        },
      });

      if (result.status !== 'captured' && creds.mode !== 'mock') {
        // Async capture — wait for webhook; still record attempt time
        mandate.lastChargedAt = now;
        mandate.lastFailureReason = `status=${result.status}`;
        await mandate.save();
        return false;
      }

      const receivedBy =
        member?.salesPersonId?.toString() ||
        String(sub.memberId);

      await this.payments.createFromProvider({
        companyId,
        locationId: String(sub.locationId),
        memberId: String(sub.memberId),
        subscriptionId: String(sub._id),
        amount,
        paymentMode: PaymentMode.ONLINE,
        paymentDate: now.toISOString().slice(0, 10),
        providerRef: result.paymentId,
        source: PaymentSource.AUTOPAY,
        receivedById: receivedBy,
        notes: renew ? 'Autopay renewal' : 'Autopay dues collection',
      });

      if (renew) {
        // Extend expiry by original duration approximation: +1 month if unknown
        const next = new Date(sub.expiryDate);
        next.setMonth(next.getMonth() + 1);
        sub.expiryDate = next;
        sub.subscriptionStatus = SubscriptionStatus.ACTIVE;
        sub.renewalFollowUpStatus = RenewalFollowUpStatus.RENEWED;
        await sub.save();
        mandate.nextChargeAt = next;
      }

      mandate.lastChargedAt = now;
      mandate.lastFailureReason = null;
      await mandate.save();
      return true;
    } catch (err) {
      mandate.lastFailureReason =
        err instanceof Error ? err.message : String(err);
      await mandate.save();

      sub.renewalFollowUpStatus = RenewalFollowUpStatus.PENDING;
      await sub.save();

      if (member?.phone) {
        await this.whatsapp.sendPaymentFailedNotice({
          companyId,
          phone: member.phone,
          memberName: member.name,
          amount,
        });
      }
      return false;
    }
  }
}
