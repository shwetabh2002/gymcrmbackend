/**
 * Timing and safety limits for recurring billing.
 *
 * These are deliberately code constants, not env vars: they encode money-safety
 * rules (never debit twice in a day, stop after repeated failures) that should
 * not differ between environments. Per-gym behaviour lives in gym settings,
 * and the sweep interval stays env-tunable for load reasons.
 */
import { HOUR_MS } from './time.constants';

/** Never debit the same mandate twice inside this window. */
export const DOUBLE_CHARGE_WINDOW_MS = 20 * HOUR_MS;

/**
 * A charge Razorpay accepted but never confirmed is assumed lost after this,
 * and the mandate becomes eligible for a retry.
 */
export const PENDING_CHARGE_TIMEOUT_MS = 6 * HOUR_MS;

/** Consecutive failures after which a mandate is paused for human review. */
export const MAX_CONSECUTIVE_FAILURES = 3;

/** Subscriptions fetched per page inside one sweep. */
export const AUTOPAY_BATCH_SIZE = 100;

/**
 * Pages one sweep may walk (so 100 × 50 = 5,000 due subscriptions per run).
 * A cap, not a target: hitting it is logged as a warning rather than passing
 * silently, because unpaid dues must never look collected.
 */
export const AUTOPAY_MAX_ROUNDS = 50;

/** Default sweep interval; override with AUTOPAY_WORKER_INTERVAL_MS. */
export const DEFAULT_AUTOPAY_INTERVAL_MS = 1 * HOUR_MS;

/** How long a checkout / mandate registration link stays payable. */
export const CHECKOUT_LINK_TTL_MS = 1 * HOUR_MS;

/** Fallbacks when a gym has not customised its mandate terms. */
export const DEFAULT_MANDATE_MULTIPLIER = 2;
export const DEFAULT_MANDATE_VALIDITY_MONTHS = 60;

/** Bounds accepted from the API for those per-gym settings. */
export const MANDATE_MULTIPLIER_RANGE = { min: 1, max: 10 } as const;
export const MANDATE_VALIDITY_MONTHS_RANGE = { min: 1, max: 120 } as const;
