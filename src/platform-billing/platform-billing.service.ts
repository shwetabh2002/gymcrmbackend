import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  PlatformSubscription,
  PlatformSubscriptionDocument,
} from './schemas/platform-subscription.schema';
import {
  PlatformCharge,
  PlatformChargeDocument,
} from './schemas/platform-charge.schema';
import { PlatformPlansService } from './platform-plans.service';
import {
  BillingInterval,
  BillingStatus,
  DEFAULT_TRIAL_DAYS,
  DUNNING_GRACE_MS,
  DUNNING_RETRY_DAYS,
  MAX_DUNNING_ATTEMPTS,
  PlatformFeature,
  canWrite,
  computePeriodAmount,
  periodLengthMs,
} from '../config/platform-billing.config';
import { Location, LocationDocument } from '../locations/schemas/location.schema';
import { Company, CompanyDocument } from '../companies/schemas/company.schema';
import { CountersService } from '../counters/counters.service';
import { DAY_MS, addDays, daysBetween } from '../config/time.constants';
import { RuntimeService } from '../common/runtime/runtime.service';
import {
  GymSettings,
  GymSettingsDocument,
} from '../gym-settings/schemas/gym-settings.schema';

/** What every caller needs to know about a gym's standing, in one shape. */
export type BillingSnapshot = {
  status: BillingStatus;
  planCode: string;
  planName: string;
  interval: BillingInterval;
  currency: string;
  /** Null once the trial is over. */
  trialEndsAt: Date | null;
  trialDaysLeft: number | null;
  currentPeriodEnd: Date | null;
  branches: number;
  pricePerBranch: number;
  /** What the next charge will be, at today's branch count. */
  nextAmount: number;
  features: PlatformFeature[];
  maxBranches: number | null;
  maxMembers: number | null;
  /** False once the account is read-only. */
  canWrite: boolean;
  mandateApproved: boolean;
  mandateShareUrl: string | null;
  lastFailureReason: string | null;
  cancelledAt: Date | null;
};

@Injectable()
export class PlatformBillingService {
  private readonly logger = new Logger(PlatformBillingService.name);

  constructor(
    @InjectModel(PlatformSubscription.name)
    private subModel: Model<PlatformSubscriptionDocument>,
    @InjectModel(PlatformCharge.name)
    private chargeModel: Model<PlatformChargeDocument>,
    @InjectModel(Location.name)
    private locationModel: Model<LocationDocument>,
    @InjectModel(Company.name)
    private companyModel: Model<CompanyDocument>,
    @InjectModel(GymSettings.name)
    private gymSettingsModel: Model<GymSettingsDocument>,
    private plans: PlatformPlansService,
    private counters: CountersService,
    private runtime: RuntimeService,
  ) {}


  /** Plan features plus SUPER_ADMIN gym-level unlocks (Autopay / WA / Email). */
  private async effectiveFeatures(
    companyId: string,
    planFeatures: PlatformFeature[],
  ): Promise<PlatformFeature[]> {
    const features = new Set<PlatformFeature>(planFeatures || []);
    const settings = await this.gymSettingsModel
      .findOne({ companyId: new Types.ObjectId(companyId) })
      .select(
        'featureAutopayUnlocked featureWhatsappUnlocked featureEmailTemplatesUnlocked',
      )
      .lean()
      .exec();
    if (settings?.featureAutopayUnlocked) features.add('AUTOPAY');
    if (settings?.featureWhatsappUnlocked) features.add('WHATSAPP_CLOUD');
    if (settings?.featureEmailTemplatesUnlocked) features.add('EMAIL_TEMPLATES');
    return [...features];
  }

  // ───────────────────────── Lifecycle ─────────────────────────

  /**
   * Every new gym starts here. Called from signup, so no gym can exist without
   * a billing record — an account with no standing is one nobody can reason
   * about later.
   */
  async startTrial(
    companyId: string,
    planCode?: string,
  ): Promise<PlatformSubscriptionDocument> {
    const existing = await this.subModel.findOne({ companyId }).exec();
    if (existing) return existing;

    const plan = planCode
      ? await this.plans.findByCode(planCode)
      : await this.defaultPlan();
    if ((plan as any).isContactSales === true) {
      throw new BadRequestException(
        'Custom is sales-led — start on Starter or Growth, then submit a Custom inquiry.',
      );
    }

    const trialDays = plan.trialDays ?? DEFAULT_TRIAL_DAYS;
    const trialEndsAt = addDays(new Date(), trialDays);

    const created = await this.subModel.create({
      companyId: new Types.ObjectId(companyId),
      planId: plan._id,
      planCode: plan.code,
      pricePerBranch: plan.pricePerBranch,
      interval: plan.interval,
      currency: plan.currency,
      status: 'TRIALING',
      trialEndsAt,
      billedBranches: 1,
    });

    this.logger.log(
      `Company ${companyId} started a ${trialDays}-day trial on ${plan.code}`,
    );
    return created;
  }

  /** First self-serve public plan (Starter) — never Custom / contact-sales. */
  private async defaultPlan() {
    const publicPlans = await this.plans.listPublic();
    const selfServe = publicPlans.filter((p) => !p.isContactSales);
    const pick = selfServe[0] || publicPlans[0];
    if (!pick) {
      throw new BadRequestException(
        'No platform plans are configured — add one in the plans table',
      );
    }
    return this.plans.findByCode(pick.code);
  }

  async getSubscription(
    companyId: string,
  ): Promise<PlatformSubscriptionDocument> {
    const sub = await this.subModel.findOne({ companyId }).exec();
    if (sub) return sub;
    // A gym created before billing existed still needs a standing.
    return this.startTrial(companyId);
  }

  /** Active branches drive the price, so the count is read live. */
  async countBranches(companyId: string): Promise<number> {
    const count = await this.locationModel
      .countDocuments({ companyId, status: 'ACTIVE' })
      .exec();
    return Math.max(1, count);
  }

  // ───────────────────────── Reading state ─────────────────────────

  async snapshot(companyId: string): Promise<BillingSnapshot> {
    const sub = await this.getSubscription(companyId);
    const plan = await this.plans.findById(String(sub.planId));
    const branches = await this.countBranches(companyId);

    const now = new Date();
    const trialDaysLeft =
      sub.status === 'TRIALING' && sub.trialEndsAt
        ? Math.max(0, daysBetween(now, sub.trialEndsAt))
        : null;
    const features = await this.effectiveFeatures(
      companyId,
      (plan?.features || []) as PlatformFeature[],
    );

    return {
      status: sub.status,
      planCode: sub.planCode,
      planName: plan?.name || sub.planCode,
      interval: sub.interval,
      currency: sub.currency,
      trialEndsAt: sub.trialEndsAt,
      trialDaysLeft,
      currentPeriodEnd: sub.currentPeriodEnd,
      branches,
      pricePerBranch: sub.pricePerBranch,
      nextAmount: computePeriodAmount({
        pricePerBranch: sub.pricePerBranch,
        branches,
        interval: sub.interval,
      }),
      features,
      maxBranches: plan?.maxBranches ?? null,
      maxMembers: plan?.maxMembers ?? null,
      canWrite: canWrite(sub.status),
      mandateApproved: !!sub.mandateTokenId,
      mandateShareUrl: sub.mandateShareUrl,
      lastFailureReason: sub.lastFailureReason,
      cancelledAt: sub.cancelledAt,
    };
  }

  /** Feature gate — used by the guard and by any service offering a feature. */
  async hasFeature(
    companyId: string,
    feature: PlatformFeature,
  ): Promise<boolean> {
    const sub = await this.getSubscription(companyId);
    const plan = await this.plans.findById(String(sub.planId));
    const features = await this.effectiveFeatures(
      companyId,
      (plan?.features || []) as PlatformFeature[],
    );
    return features.includes(feature);
  }

  async charges(companyId: string, limit = 24) {
    const rows = await this.chargeModel
      .find({ companyId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec();
    return rows.map((c) => ({
      id: String(c._id),
      invoiceNumber: c.invoiceNumber,
      planCode: c.planCode,
      branches: c.branches,
      subtotal: c.subtotal,
      taxAmount: c.taxAmount,
      totalAmount: c.totalAmount,
      currency: c.currency,
      status: c.status,
      periodStart: c.periodStart,
      periodEnd: c.periodEnd,
      paidAt: c.paidAt,
      failureReason: c.failureReason,
      createdAt: (c as any).createdAt,
    }));
  }

  // ───────────────────────── Plan changes ─────────────────────────

  /**
   * Move a gym onto a plan. Used both for the first paid subscription and for
   * upgrades. Downgrading below the branches already in use is refused rather
   * than silently disabling branches.
   */
  async changePlan(
    companyId: string,
    planCode: string,
    interval: BillingInterval = 'MONTHLY',
  ) {
    const sub = await this.getSubscription(companyId);
    const plan = await this.plans.findByCode(planCode);
    if ((plan as any).isContactSales === true) {
      throw new BadRequestException(
        'Custom plans are sales-led. Submit the Custom inquiry form and we will reach out.',
      );
    }
    const branches = await this.countBranches(companyId);

    if (plan.maxBranches != null && branches > plan.maxBranches) {
      throw new BadRequestException(
        `${plan.name} covers ${plan.maxBranches} branch${plan.maxBranches === 1 ? '' : 'es'}, ` +
          `but this gym has ${branches}. Pick a larger plan or deactivate branches first.`,
      );
    }

    sub.planId = plan._id as any;
    sub.planCode = plan.code;
    sub.pricePerBranch = plan.pricePerBranch;
    sub.interval = interval;
    sub.currency = plan.currency;
    // A plan change never revives a cancelled account on its own; the caller
    // resubscribes explicitly.
    if (sub.status === 'READ_ONLY' || sub.status === 'CANCELLED') {
      sub.status = sub.mandateTokenId ? 'ACTIVE' : 'TRIALING';
      if (sub.status === 'TRIALING' && !sub.trialEndsAt) {
        sub.trialEndsAt = addDays(new Date(), plan.trialDays);
      }
      sub.cancelledAt = null;
    }
    await sub.save();

    this.logger.log(`Company ${companyId} moved to ${plan.code} (${interval})`);
    return this.snapshot(companyId);
  }

  /** Access continues to the end of the paid period. */
  async cancel(companyId: string, reason?: string) {
    const sub = await this.getSubscription(companyId);
    sub.cancelledAt = new Date();
    sub.cancellationReason = reason?.trim() || null;
    // Still writable until the period runs out — the sweep flips it later.
    if (sub.status === 'TRIALING') {
      sub.status = 'READ_ONLY';
    }
    await sub.save();
    return this.snapshot(companyId);
  }

  async resume(companyId: string) {
    const sub = await this.getSubscription(companyId);
    sub.cancelledAt = null;
    sub.cancellationReason = null;
    if (sub.status === 'READ_ONLY' && sub.mandateTokenId) {
      sub.status = 'ACTIVE';
    }
    await sub.save();
    return this.snapshot(companyId);
  }

  // ───────────────────────── Mandate + charging ─────────────────────────

  /** Records the mandate a gym approved for our fees. */
  async attachMandate(
    companyId: string,
    input: { tokenId: string; customerId?: string | null },
  ) {
    const sub = await this.getSubscription(companyId);
    sub.mandateTokenId = input.tokenId;
    sub.mandateCustomerId = input.customerId || null;
    sub.mandateApprovedAt = new Date();
    sub.mandateShareUrl = null;
    sub.mandateAuthLinkId = null;
    sub.lastFailureReason = null;
    sub.dunningAttempts = 0;
    sub.nextRetryAt = null;
    // An approved mandate on an expired trial revives the account immediately.
    if (sub.status === 'READ_ONLY' || sub.status === 'PAST_DUE') {
      sub.status = 'ACTIVE';
    }
    await sub.save();
    this.logger.log(`Company ${companyId} approved a platform mandate`);
    return this.snapshot(companyId);
  }

  async setPendingMandate(
    companyId: string,
    input: { authLinkId: string; shareUrl: string; customerId?: string | null },
  ) {
    const sub = await this.getSubscription(companyId);
    sub.mandateAuthLinkId = input.authLinkId;
    sub.mandateShareUrl = input.shareUrl;
    if (input.customerId) sub.mandateCustomerId = input.customerId;
    await sub.save();
    return sub;
  }

  /**
   * Opens a charge row before money is attempted, so a failure is explainable
   * instead of invisible.
   */
  async openCharge(sub: PlatformSubscriptionDocument, branches: number) {
    const subtotal = computePeriodAmount({
      pricePerBranch: sub.pricePerBranch,
      branches,
      interval: sub.interval,
    });
    const taxPercentage = this.runtime.platformTaxPercentage();
    const taxAmount = Math.round((subtotal * taxPercentage) / 100);
    const periodStart = sub.currentPeriodEnd || new Date();
    const periodEnd = new Date(
      periodStart.getTime() + periodLengthMs(sub.interval),
    );

    return this.chargeModel.create({
      companyId: sub.companyId,
      subscriptionId: sub._id,
      invoiceNumber: await this.counters.nextPlatformInvoiceNumber(),
      planCode: sub.planCode,
      branches,
      subtotal,
      taxPercentage,
      taxAmount,
      totalAmount: subtotal + taxAmount,
      currency: sub.currency,
      status: 'PENDING',
      periodStart,
      periodEnd,
    });
  }

  /** A charge succeeded: extend the period and clear any dunning state. */
  async markChargePaid(
    sub: PlatformSubscriptionDocument,
    charge: PlatformChargeDocument,
    providerRef: string,
  ) {
    charge.status = 'PAID';
    charge.providerRef = providerRef;
    charge.paidAt = new Date();
    await charge.save();

    sub.status = 'ACTIVE';
    sub.currentPeriodStart = charge.periodStart;
    sub.currentPeriodEnd = charge.periodEnd;
    sub.billedBranches = charge.branches;
    sub.lastAmount = charge.totalAmount;
    sub.lastChargeAt = new Date();
    sub.lastFailureReason = null;
    sub.dunningAttempts = 0;
    sub.nextRetryAt = null;
    sub.trialEndsAt = null;
    await sub.save();

    await this.syncCompanyStatus(String(sub.companyId), 'ACTIVE');
  }

  /**
   * A charge failed. Retries follow DUNNING_RETRY_DAYS; once they run out the
   * account goes read-only after a grace window rather than at once.
   */
  async markChargeFailed(
    sub: PlatformSubscriptionDocument,
    charge: PlatformChargeDocument | null,
    reason: string,
  ) {
    if (charge) {
      charge.status = 'FAILED';
      charge.failureReason = reason;
      await charge.save();
    }

    sub.dunningAttempts = (sub.dunningAttempts || 0) + 1;
    sub.lastFailureReason = reason;

    if (sub.dunningAttempts <= MAX_DUNNING_ATTEMPTS) {
      const waitDays =
        DUNNING_RETRY_DAYS[sub.dunningAttempts - 1] ??
        DUNNING_RETRY_DAYS[DUNNING_RETRY_DAYS.length - 1];
      sub.status = 'PAST_DUE';
      sub.nextRetryAt = addDays(new Date(), waitDays);
      this.logger.warn(
        `Company ${sub.companyId} charge failed (${sub.dunningAttempts}/${MAX_DUNNING_ATTEMPTS}): ${reason}`,
      );
    } else {
      // Retries exhausted — one last grace window, then read-only.
      sub.nextRetryAt = new Date(Date.now() + DUNNING_GRACE_MS);
      sub.status = 'PAST_DUE';
      this.logger.warn(
        `Company ${sub.companyId} exhausted dunning; read-only after the grace window`,
      );
    }
    await sub.save();
  }

  async setStatus(companyId: string, status: BillingStatus, reason?: string) {
    const sub = await this.getSubscription(companyId);
    sub.status = status;
    if (reason) sub.lastFailureReason = reason;
    await sub.save();
    await this.syncCompanyStatus(companyId, status);
    return sub;
  }

  /**
   * Keeps Company.status readable on its own — SUPER_ADMIN screens and the
   * company list should not have to join to explain an account.
   */
  private async syncCompanyStatus(companyId: string, status: BillingStatus) {
    const companyStatus =
      status === 'ACTIVE' || status === 'PAST_DUE'
        ? 'ACTIVE'
        : status === 'TRIALING'
          ? 'TRIAL'
          : 'SUSPENDED';
    await this.companyModel
      .updateOne({ _id: companyId }, { status: companyStatus })
      .exec()
      .catch(() => undefined);
  }

  // ───────────────────────── Platform-wide reporting ─────────────────────────

  /** SUPER_ADMIN overview: who is trialing, paying, failing, gone. */
  async overview() {
    const [byStatus, revenue, expiringSoon] = await Promise.all([
      this.subModel
        .aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }])
        .exec(),
      this.chargeModel
        .aggregate([
          { $match: { status: 'PAID' } },
          {
            $group: {
              _id: null,
              total: { $sum: '$totalAmount' },
              count: { $sum: 1 },
            },
          },
        ])
        .exec(),
      this.subModel
        .find({
          status: 'TRIALING',
          trialEndsAt: { $lte: addDays(new Date(), 3), $gte: new Date() },
        })
        .populate('companyId', 'name slug')
        .sort({ trialEndsAt: 1 })
        .limit(25)
        .lean()
        .exec(),
    ]);

    const counts: Record<string, number> = {};
    byStatus.forEach((row: any) => {
      counts[row._id] = row.count;
    });

    // Recurring revenue, normalised to a month so the number means one thing.
    const active = await this.subModel
      .find({ status: { $in: ['ACTIVE', 'PAST_DUE'] } })
      .lean()
      .exec();
    const mrr = active.reduce((sum, s: any) => {
      const perMonth =
        s.interval === 'YEARLY'
          ? (s.pricePerBranch * (s.billedBranches || 1) * 10) / 12
          : s.pricePerBranch * (s.billedBranches || 1);
      return sum + perMonth;
    }, 0);

    return {
      counts: {
        trialing: counts.TRIALING || 0,
        active: counts.ACTIVE || 0,
        pastDue: counts.PAST_DUE || 0,
        readOnly: counts.READ_ONLY || 0,
        cancelled: counts.CANCELLED || 0,
        total: active.length + (counts.TRIALING || 0) + (counts.READ_ONLY || 0),
      },
      mrr: Math.round(mrr),
      lifetimeRevenue: revenue[0]?.total || 0,
      paidCharges: revenue[0]?.count || 0,
      trialsEndingSoon: expiringSoon.map((s: any) => ({
        companyId: String(s.companyId?._id ?? s.companyId),
        companyName: s.companyId?.name ?? 'Unknown',
        planCode: s.planCode,
        trialEndsAt: s.trialEndsAt,
        daysLeft: Math.max(0, daysBetween(new Date(), new Date(s.trialEndsAt))),
      })),
    };
  }

  /** Every gym with its billing standing — the SUPER_ADMIN companies table. */
  async listCompanies(status?: string) {
    const filter = status && status !== 'ALL' ? { status } : {};
    const subs = await this.subModel
      .find(filter)
      .populate('companyId', 'name slug city phone createdAt')
      .sort({ createdAt: -1 })
      .limit(500)
      .lean()
      .exec();

    return subs.map((s: any) => ({
      companyId: String(s.companyId?._id ?? s.companyId),
      companyName: s.companyId?.name ?? 'Unknown',
      city: s.companyId?.city ?? null,
      phone: s.companyId?.phone ?? null,
      signedUpAt: s.companyId?.createdAt ?? null,
      status: s.status,
      planCode: s.planCode,
      interval: s.interval,
      pricePerBranch: s.pricePerBranch,
      branches: s.billedBranches,
      trialEndsAt: s.trialEndsAt,
      currentPeriodEnd: s.currentPeriodEnd,
      lastChargeAt: s.lastChargeAt,
      lastAmount: s.lastAmount,
      mandateApproved: !!s.mandateTokenId,
      dunningAttempts: s.dunningAttempts || 0,
      lastFailureReason: s.lastFailureReason,
      cancelledAt: s.cancelledAt,
    }));
  }

  /** Rows the sweep needs to act on. */
  async findDue(now = new Date()) {
    const [expiredTrials, dueRenewals, retries] = await Promise.all([
      this.subModel
        .find({ status: 'TRIALING', trialEndsAt: { $lte: now } })
        .limit(200)
        .exec(),
      this.subModel
        .find({
          status: 'ACTIVE',
          currentPeriodEnd: { $lte: now },
          cancelledAt: null,
        })
        .limit(200)
        .exec(),
      this.subModel
        .find({ status: 'PAST_DUE', nextRetryAt: { $lte: now } })
        .limit(200)
        .exec(),
    ]);
    return { expiredTrials, dueRenewals, retries };
  }

  /** Trials approaching their end, for reminder mails. */
  async findTrialsNeedingReminder(daysLeft: number, now = new Date()) {
    const windowStart = new Date(now.getTime() + (daysLeft - 1) * DAY_MS);
    const windowEnd = new Date(now.getTime() + daysLeft * DAY_MS);
    return this.subModel
      .find({
        status: 'TRIALING',
        trialEndsAt: { $gt: windowStart, $lte: windowEnd },
        trialRemindersSent: { $ne: daysLeft },
      })
      .limit(200)
      .exec();
  }

  async markReminderSent(
    sub: PlatformSubscriptionDocument,
    daysLeft: number,
  ) {
    sub.trialRemindersSent = [
      ...new Set([...(sub.trialRemindersSent || []), daysLeft]),
    ];
    await sub.save();
  }

  async findCharge(id: string) {
    return this.chargeModel.findById(id).exec();
  }

  async findChargeByProviderRef(providerRef: string) {
    return this.chargeModel.findOne({ providerRef }).exec();
  }
}
