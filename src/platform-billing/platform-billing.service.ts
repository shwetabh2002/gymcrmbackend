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
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  ActivityLogsService,
  ActivityActor,
} from '../activity-logs/activity-logs.service';
import { Role } from '../common/enums/role.enum';

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
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  branches: number;
  pricePerBranch: number;
  /** What the next charge will be, at today's branch count. */
  nextAmount: number;
  lastAmount: number | null;
  lastChargeAt: Date | null;
  /** How fees are collected — one-time Checkout vs Autopay mandate. */
  billingMode: 'ONE_TIME' | 'AUTOPAY' | null;
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
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
    private plans: PlatformPlansService,
    private counters: CountersService,
    private runtime: RuntimeService,
    private activityLogs: ActivityLogsService,
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
        'featureAutopayUnlocked featureWhatsappUnlocked featureEmailTemplatesUnlocked featureActivityLogsUnlocked',
      )
      .lean()
      .exec();
    if (settings?.featureAutopayUnlocked) features.add('AUTOPAY');
    if (settings?.featureWhatsappUnlocked) features.add('WHATSAPP_CLOUD');
    if (settings?.featureEmailTemplatesUnlocked) features.add('EMAIL_TEMPLATES');
    if (settings?.featureActivityLogsUnlocked) features.add('ACTIVITY_LOGS');
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
      currentPeriodStart: sub.currentPeriodStart,
      currentPeriodEnd: sub.currentPeriodEnd,
      branches,
      pricePerBranch: sub.pricePerBranch,
      nextAmount: computePeriodAmount({
        pricePerBranch: sub.pricePerBranch,
        branches,
        interval: sub.interval,
      }),
      lastAmount: sub.lastAmount ?? null,
      lastChargeAt: sub.lastChargeAt ?? null,
      billingMode:
        sub.billingMode ||
        (sub.mandateTokenId ? 'AUTOPAY' : sub.status === 'ACTIVE' ? 'ONE_TIME' : null),
      features,
      maxBranches: plan?.maxBranches ?? null,
      maxMembers: plan?.maxMembers ?? null,
      canWrite: canWrite(sub.status, sub.trialEndsAt),
      mandateApproved: !!sub.mandateTokenId,
      // Only surface a pending Autopay link — never leftover one-time plinks.
      mandateShareUrl:
        sub.mandateTokenId || sub.billingMode === 'ONE_TIME'
          ? null
          : sub.mandateShareUrl,
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
    const [rows, company, owner] = await Promise.all([
      this.chargeModel
        .find({ companyId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean()
        .exec(),
      this.companyModel.findById(companyId).select('name phone city').lean().exec(),
      this.userModel
        .findOne({ companyId, role: 'ADMIN' })
        .select('name email phone')
        .lean()
        .exec(),
    ]);

    const billTo = {
      name: (company as any)?.name || 'Gym',
      email: (owner as any)?.email || null,
      phone: (owner as any)?.phone || (company as any)?.phone || null,
      city: (company as any)?.city || null,
    };

    return rows.map((c) => ({
      id: String(c._id),
      invoiceNumber: c.invoiceNumber,
      planCode: c.planCode,
      branches: c.branches,
      subtotal: c.subtotal,
      taxPercentage: c.taxPercentage ?? 0,
      taxAmount: c.taxAmount,
      totalAmount: c.totalAmount,
      currency: c.currency,
      status: c.status,
      periodStart: c.periodStart,
      periodEnd: c.periodEnd,
      paidAt: c.paidAt,
      failureReason: c.failureReason,
      createdAt: (c as any).createdAt,
      razorpayOrderId: c.razorpayOrderId ?? null,
      razorpayPaymentId: c.razorpayPaymentId ?? c.providerRef ?? null,
      paymentMethod: c.paymentMethod ?? null,
      paymentInstrument: c.paymentInstrument ?? null,
      payMode: c.payMode ?? null,
      providerStatus: c.providerStatus ?? null,
      billTo,
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
    // Never revive READ_ONLY / CANCELLED via plan change alone — that would let
    // any gym staff restore write access + new features without paying.
    // Use resume (mandate) or SUPER_ADMIN extend-trial for recovery.
    if (sub.status === 'READ_ONLY' || sub.status === 'CANCELLED') {
      throw new BadRequestException(
        'This subscription is not active. Complete payment / mandate to resume, or ask platform support to extend the trial.',
      );
    }
    await sub.save();
    this.activityLogs.invalidateAccessCache(companyId);

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
    sub.billingMode = 'AUTOPAY';
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
    // Pending Autopay setup only — never overwrite an active one-time period.
    if (!sub.mandateTokenId) {
      sub.billingMode = null;
    }
    sub.mandateAuthLinkId = input.authLinkId;
    sub.mandateShareUrl = input.shareUrl;
    if (input.customerId) sub.mandateCustomerId = input.customerId;
    await sub.save();
    return sub;
  }

  /**
   * One-time Checkout paid — drop any leftover Payment Link / mandate registration
   * fields so the doc does not look like an incomplete Autopay setup.
   */
  async markOneTimeBilling(companyId: string) {
    const sub = await this.getSubscription(companyId);
    if (sub.mandateTokenId) return sub;
    sub.billingMode = 'ONE_TIME';
    sub.mandateAuthLinkId = null;
    sub.mandateShareUrl = null;
    // Customer id from an old plink is not a mandate — clear it too.
    if (!sub.mandateApprovedAt) {
      sub.mandateCustomerId = null;
    }
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
    meta?: {
      orderId?: string | null;
      paymentId?: string | null;
      signature?: string | null;
      payMode?: string | null;
      method?: string | null;
      customerId?: string | null;
      email?: string | null;
      contact?: string | null;
      instrument?: string | null;
      amountPaise?: number | null;
      providerStatus?: string | null;
      paidAt?: Date | null;
    },
  ) {
    charge.status = 'PAID';
    charge.providerRef = providerRef;
    charge.paidAt = meta?.paidAt || new Date();
    if (meta?.orderId) charge.razorpayOrderId = meta.orderId;
    if (meta?.paymentId) charge.razorpayPaymentId = meta.paymentId;
    else if (providerRef?.startsWith('pay_')) {
      charge.razorpayPaymentId = providerRef;
    }
    if (meta?.signature) charge.razorpaySignature = meta.signature;
    if (meta?.payMode) charge.payMode = meta.payMode;
    if (meta?.method) charge.paymentMethod = meta.method;
    if (meta?.customerId) charge.razorpayCustomerId = meta.customerId;
    if (meta?.email) charge.payerEmail = meta.email;
    if (meta?.contact) charge.payerContact = meta.contact;
    if (meta?.instrument) charge.paymentInstrument = meta.instrument;
    if (meta?.amountPaise != null) charge.amountPaise = meta.amountPaise;
    if (meta?.providerStatus) charge.providerStatus = meta.providerStatus;
    await charge.save();

    // Drop superseded checkout attempts so history doesn't look unpaid.
    await this.chargeModel
      .updateMany(
        {
          companyId: sub.companyId,
          _id: { $ne: charge._id },
          status: 'PENDING',
        },
        {
          $set: {
            status: 'FAILED',
            failureReason: 'Superseded by a completed payment',
          },
        },
      )
      .exec()
      .catch(() => undefined);

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
    // One-time pay: keep the doc as period billing, not a half-finished mandate.
    if (!sub.mandateTokenId) {
      sub.billingMode = 'ONE_TIME';
      sub.mandateAuthLinkId = null;
      sub.mandateShareUrl = null;
      if (!sub.mandateApprovedAt) {
        sub.mandateCustomerId = null;
      }
    } else if (!sub.billingMode) {
      sub.billingMode = 'AUTOPAY';
    }
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

  /**
   * Every gym with billing standing — SUPER_ADMIN table.
   * Optional `q` matches gym name, phone, city, slug, or admin email.
   */
  async listCompanies(status?: string, q?: string) {
    const filter: Record<string, unknown> =
      status && status !== 'ALL' ? { status } : {};

    const term = (q || '').trim();
    if (term) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(escaped, 'i');
      const [byCompany, byEmail] = await Promise.all([
        this.companyModel
          .find({
            $or: [
              { name: rx },
              { phone: rx },
              { city: rx },
              { slug: rx },
            ],
          })
          .select('_id')
          .lean()
          .exec(),
        this.userModel
          .find({
            email: rx,
            companyId: { $ne: null },
          })
          .select('companyId')
          .lean()
          .exec(),
      ]);
      const ids = [
        ...new Set([
          ...byCompany.map((c: any) => String(c._id)),
          ...byEmail.map((u: any) => String(u.companyId)),
        ]),
      ].map((id) => new Types.ObjectId(id));
      if (!ids.length) return [];
      filter.companyId = { $in: ids };
    }

    const subs = await this.subModel
      .find(filter)
      .populate('companyId', 'name slug city phone createdAt')
      .sort({ createdAt: -1 })
      .limit(500)
      .lean()
      .exec();

    const companyIds = subs
      .map((s: any) => s.companyId?._id ?? s.companyId)
      .filter(Boolean);
    const admins = companyIds.length
      ? await this.userModel
          .find({
            companyId: { $in: companyIds },
            role: Role.ADMIN,
          })
          .select('companyId email name')
          .lean()
          .exec()
      : [];
    const adminByCompany = new Map<string, { email: string; name: string }>();
    for (const a of admins as any[]) {
      const cid = String(a.companyId);
      if (!adminByCompany.has(cid)) {
        adminByCompany.set(cid, { email: a.email, name: a.name });
      }
    }

    return subs.map((s: any) => {
      const companyId = String(s.companyId?._id ?? s.companyId);
      const admin = adminByCompany.get(companyId);
      return {
        companyId,
        companyName: s.companyId?.name ?? 'Unknown',
        city: s.companyId?.city ?? null,
        phone: s.companyId?.phone ?? null,
        adminEmail: admin?.email ?? null,
        adminName: admin?.name ?? null,
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
      };
    });
  }

  /**
   * SUPER_ADMIN: bump or set trial end. Revives READ_ONLY / CANCELLED into TRIALING.
   */
  async extendTrial(
    companyId: string,
    opts: { days?: number; until?: string },
    actor?: ActivityActor,
  ) {
    const sub = await this.getSubscription(companyId);
    const prevEnds = sub.trialEndsAt;
    const prevStatus = sub.status;

    let newEnd: Date;
    if (opts.until) {
      newEnd = new Date(opts.until);
      if (Number.isNaN(newEnd.getTime())) {
        throw new BadRequestException('until must be a valid date');
      }
    } else {
      const days = opts.days != null ? Number(opts.days) : 7;
      if (!Number.isFinite(days) || days < 1 || days > 365) {
        throw new BadRequestException('days must be between 1 and 365');
      }
      const base =
        sub.trialEndsAt && new Date(sub.trialEndsAt).getTime() > Date.now()
          ? new Date(sub.trialEndsAt)
          : new Date();
      newEnd = addDays(base, Math.round(days));
    }

    if (newEnd.getTime() <= Date.now()) {
      throw new BadRequestException('New trial end must be in the future');
    }

    sub.trialEndsAt = newEnd;
    sub.status = 'TRIALING';
    sub.cancelledAt = null;
    sub.cancellationReason = null;
    sub.trialRemindersSent = [];
    await sub.save();
    await this.syncCompanyStatus(companyId, 'TRIALING');

    if (actor) {
      await this.activityLogs.log({
        companyId,
        actor,
        action: 'TRIAL_EXTENDED',
        entityType: 'platform_subscription',
        entityId: String(sub._id),
        summary: `Trial extended to ${newEnd.toISOString().slice(0, 10)} (was ${prevStatus})`,
        metadata: {
          previousStatus: prevStatus,
          previousTrialEndsAt: prevEnds,
          newTrialEndsAt: newEnd,
          days: opts.days ?? null,
          until: opts.until ?? null,
        },
      });
    }

    this.logger.log(
      `Company ${companyId} trial extended to ${newEnd.toISOString()} by ${actor?.userId || 'system'}`,
    );
    return this.snapshot(companyId);
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
    if (!providerRef) return null;
    return this.chargeModel
      .findOne({
        $or: [
          { providerRef },
          { razorpayPaymentId: providerRef },
          { razorpayOrderId: providerRef },
        ],
      })
      .exec();
  }

  async findChargeByOrderId(orderId: string) {
    if (!orderId) return null;
    return this.chargeModel
      .findOne({
        $or: [{ razorpayOrderId: orderId }, { providerRef: orderId }],
      })
      .exec();
  }
}
