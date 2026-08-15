import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PlatformBillingService } from './platform-billing.service';
import { PlatformChargingService } from './platform-charging.service';
import { JobLockService } from '../common/locks/job-lock.service';
import { EmailTemplatesService } from '../email/email-templates.service';
import { EMAIL_TYPES } from '../config/email-templates.config';
import {
  BILLING_LOCK_KEY,
  BILLING_SWEEP_INTERVAL_MS,
  MAX_DUNNING_ATTEMPTS,
  TRIAL_REMINDER_DAYS,
} from '../config/platform-billing.config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import { RuntimeService } from '../common/runtime/runtime.service';
import { CRM_ROUTES } from '../config/crm-routes.config';
import { toIsoDate } from '../config/time.constants';

export type BillingSweepSummary = {
  trialsExpired: number;
  renewalsCharged: number;
  retriesCharged: number;
  failed: number;
  remindersSent: number;
  alreadyRunning?: boolean;
};

/**
 * Moves platform subscriptions through their lifecycle: reminds gyms their
 * trial is ending, charges renewals, retries failures, and finally reduces
 * access when dunning is exhausted.
 *
 * Leased like the autopay sweep, so several instances cannot bill the same gym.
 */
@Injectable()
export class PlatformBillingWorkerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PlatformBillingWorkerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private billing: PlatformBillingService,
    private charging: PlatformChargingService,
    private jobLock: JobLockService,
    private emailTemplates: EmailTemplatesService,
    private config: ConfigService,
    private runtime: RuntimeService,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  onModuleInit() {
    if (this.config.get('PLATFORM_BILLING_ENABLED') === 'false') {
      this.logger.log('Platform billing worker disabled');
      return;
    }
    const ms =
      Number(this.config.get('PLATFORM_BILLING_INTERVAL_MS')) ||
      BILLING_SWEEP_INTERVAL_MS;
    this.timer = setInterval(() => void this.sweep(), ms);
    this.logger.log(`Platform billing worker interval ${ms}ms`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(): Promise<BillingSweepSummary> {
    const result = await this.jobLock.runExclusively(BILLING_LOCK_KEY, () =>
      this.run(),
    );
    if (result === null) {
      return {
        trialsExpired: 0,
        renewalsCharged: 0,
        retriesCharged: 0,
        failed: 0,
        remindersSent: 0,
        alreadyRunning: true,
      };
    }
    return result;
  }

  private async run(): Promise<BillingSweepSummary> {
    const now = new Date();
    const summary: BillingSweepSummary = {
      trialsExpired: 0,
      renewalsCharged: 0,
      retriesCharged: 0,
      failed: 0,
      remindersSent: 0,
    };

    summary.remindersSent = await this.sendTrialReminders();

    const { expiredTrials, dueRenewals, retries } =
      await this.billing.findDue(now);

    // A trial that ends with an approved mandate simply becomes a paying
    // account; without one it goes read-only rather than being locked out.
    for (const sub of expiredTrials) {
      try {
        if (sub.mandateTokenId) {
          const outcome = await this.charging.chargeSubscription(sub);
          if (outcome === 'charged') summary.renewalsCharged += 1;
          else if (outcome === 'failed') summary.failed += 1;
        } else {
          await this.billing.setStatus(
            String(sub.companyId),
            'READ_ONLY',
            'Trial ended without a payment method',
          );
          await this.notifyTrialEnded(String(sub.companyId));
          summary.trialsExpired += 1;
        }
      } catch (err) {
        summary.failed += 1;
        this.logger.warn(
          `Trial transition failed for ${sub.companyId}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }

    for (const sub of dueRenewals) {
      const outcome = await this.charging.chargeSubscription(sub);
      if (outcome === 'charged') summary.renewalsCharged += 1;
      else if (outcome === 'failed') summary.failed += 1;
    }

    for (const sub of retries) {
      // Retries are exhausted: the grace window has passed, so reduce access.
      if (sub.dunningAttempts > MAX_DUNNING_ATTEMPTS) {
        await this.billing.setStatus(
          String(sub.companyId),
          'READ_ONLY',
          sub.lastFailureReason || 'Payment could not be collected',
        );
        continue;
      }
      const outcome = await this.charging.chargeSubscription(sub);
      if (outcome === 'charged') summary.retriesCharged += 1;
      else if (outcome === 'failed') summary.failed += 1;
    }

    if (
      summary.trialsExpired ||
      summary.renewalsCharged ||
      summary.retriesCharged ||
      summary.failed
    ) {
      this.logger.log(
        `Billing sweep: trialsExpired=${summary.trialsExpired} renewals=${summary.renewalsCharged} ` +
          `retries=${summary.retriesCharged} failed=${summary.failed} reminders=${summary.remindersSent}`,
      );
    }
    return summary;
  }

  /** "Your trial ends in N days" — sent once per milestone. */
  private async sendTrialReminders(): Promise<number> {
    let sent = 0;
    for (const daysLeft of TRIAL_REMINDER_DAYS) {
      const subs = await this.billing.findTrialsNeedingReminder(daysLeft);
      for (const sub of subs) {
        const companyId = String(sub.companyId);
        const owner = await this.ownerOf(companyId);
        if (owner?.email) {
          await this.emailTemplates
            .sendTemplated({
              companyId,
              type: EMAIL_TYPES.trialEnding,
              to: owner.email,
              vars: {
                adminName: owner.name || 'there',
                daysLeft,
                trialEndsAt: sub.trialEndsAt
                  ? toIsoDate(sub.trialEndsAt)
                  : '',
                planCode: sub.planCode,
                billingUrl: this.runtime.crmUrl(CRM_ROUTES.subscription),
              },
            })
            .catch(() => undefined);
        }
        await this.billing.markReminderSent(sub, daysLeft);
        sent += 1;
      }
    }
    return sent;
  }

  private async notifyTrialEnded(companyId: string) {
    const owner = await this.ownerOf(companyId);
    if (!owner?.email) return;
    await this.emailTemplates
      .sendTemplated({
        companyId,
        type: EMAIL_TYPES.trialEnded,
        to: owner.email,
        vars: {
          adminName: owner.name || 'there',
          billingUrl: this.runtime.crmUrl(CRM_ROUTES.subscription),
        },
      })
      .catch(() => undefined);
  }

  private async ownerOf(companyId: string) {
    return this.userModel
      .findOne({ companyId, role: 'ADMIN' })
      .select('name email')
      .lean()
      .exec();
  }
}
