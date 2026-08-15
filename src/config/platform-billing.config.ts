import { DAY_MS } from './time.constants';

/**
 * The platform's own subscription model: what a gym pays us to use the CRM.
 *
 * Kept separate from everything a gym charges its members — same words, very
 * different money.
 */

export const BILLING_INTERVALS = ['MONTHLY', 'YEARLY'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

/** Capabilities a plan can unlock. Absent = blocked for that gym. */
export const PLATFORM_FEATURES = [
  /** UPI Autopay mandates for the gym's own members. */
  'AUTOPAY',
  /** WhatsApp Cloud API auto-send (click-to-chat always works). */
  'WHATSAPP_CLOUD',
  /** Gym-authored email templates. */
  'EMAIL_TEMPLATES',
  /** More than one branch. */
  'MULTI_BRANCH',
  /** Staff accounts with per-permission access. */
  'STAFF_RBAC',
] as const;
export type PlatformFeature = (typeof PLATFORM_FEATURES)[number];

export function isPlatformFeature(value: unknown): value is PlatformFeature {
  return (
    typeof value === 'string' &&
    (PLATFORM_FEATURES as readonly string[]).includes(value)
  );
}

/**
 * Where a gym stands with us.
 *
 *   TRIALING  → inside the free window, everything works
 *   ACTIVE    → paying, everything works
 *   PAST_DUE  → a charge failed; still usable while we retry
 *   READ_ONLY → trial expired or dunning gave up. They can log in, read and
 *               export, but not add members or take payments. Deliberately not
 *               a lockout: their data is theirs.
 *   CANCELLED → they left. Same access as READ_ONLY.
 */
export const BILLING_STATUSES = [
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
  'READ_ONLY',
  'CANCELLED',
] as const;
export type BillingStatus = (typeof BILLING_STATUSES)[number];

/** Statuses that still allow creating and changing data. */
export const WRITABLE_STATUSES: BillingStatus[] = [
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
];

export function canWrite(status: BillingStatus | undefined | null): boolean {
  return !!status && WRITABLE_STATUSES.includes(status);
}

/** Default free window when no plan says otherwise. */
export const DEFAULT_TRIAL_DAYS = 10;

/**
 * Dunning. A failed charge is retried on this schedule before access is
 * reduced — a gym that lost a card should not lose its front desk the same day.
 */
export const DUNNING_RETRY_DAYS = [1, 3, 5] as const;
export const MAX_DUNNING_ATTEMPTS = DUNNING_RETRY_DAYS.length;

/** Grace after the last failed retry before the account goes read-only. */
export const DUNNING_GRACE_MS = 2 * DAY_MS;

/** How often the billing sweep runs. */
export const BILLING_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Lease key so only one instance sweeps platform billing. */
export const BILLING_LOCK_KEY = 'platform-billing-sweep';

/** Trial reminders, in days remaining. */
export const TRIAL_REMINDER_DAYS = [5, 2, 1] as const;

/**
 * Seed plans. Written to the database on boot when the plans table is empty, so
 * a fresh install has something to sell; edited in the database afterwards.
 */
export const SEED_PLATFORM_PLANS = [
  {
    code: 'STARTER',
    name: 'Starter',
    description:
      'Everything a single-branch gym needs: members, plans, payments and GST invoices.',
    pricePerBranch: 999,
    interval: 'MONTHLY' as BillingInterval,
    trialDays: DEFAULT_TRIAL_DAYS,
    features: ['EMAIL_TEMPLATES'] as PlatformFeature[],
    maxBranches: 1,
    maxMembers: null,
    sortOrder: 1,
  },
  {
    code: 'GROWTH',
    name: 'Growth',
    description:
      'Adds UPI Autopay mandates, WhatsApp auto-send and staff accounts.',
    pricePerBranch: 1999,
    interval: 'MONTHLY' as BillingInterval,
    trialDays: DEFAULT_TRIAL_DAYS,
    features: [
      'AUTOPAY',
      'WHATSAPP_CLOUD',
      'EMAIL_TEMPLATES',
      'STAFF_RBAC',
    ] as PlatformFeature[],
    maxBranches: 3,
    maxMembers: null,
    sortOrder: 2,
    isRecommended: true,
  },
  {
    code: 'CHAIN',
    name: 'Chain',
    description:
      'Unlimited branches with per-branch reporting for multi-location operators.',
    pricePerBranch: 1699,
    interval: 'MONTHLY' as BillingInterval,
    trialDays: DEFAULT_TRIAL_DAYS,
    features: [
      'AUTOPAY',
      'WHATSAPP_CLOUD',
      'EMAIL_TEMPLATES',
      'MULTI_BRANCH',
      'STAFF_RBAC',
    ] as PlatformFeature[],
    maxBranches: null,
    maxMembers: null,
    sortOrder: 3,
  },
] as const;

/** Yearly billing bills 10 months — two free, which is the usual SaaS trade. */
export const YEARLY_MONTHS_CHARGED = 10;

export function periodLengthMs(interval: BillingInterval): number {
  return interval === 'YEARLY' ? 365 * DAY_MS : 30 * DAY_MS;
}

/** Amount for one period, given the plan price and how many branches are live. */
export function computePeriodAmount(input: {
  pricePerBranch: number;
  branches: number;
  interval: BillingInterval;
}): number {
  const branches = Math.max(1, input.branches);
  const months = input.interval === 'YEARLY' ? YEARLY_MONTHS_CHARGED : 1;
  return Math.round(input.pricePerBranch * branches * months);
}
