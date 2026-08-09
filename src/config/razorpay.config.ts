/**
 * Every Razorpay-specific constant lives here: hosts, paths, event names and
 * the rules their APIs impose. Nothing outside this file should contain a
 * Razorpay URL or a magic Razorpay string.
 *
 * Hosts are env-overridable so a sandbox/proxy can be pointed at without a
 * code change.
 */

export const RAZORPAY_API_BASE_URL =
  process.env.RAZORPAY_API_BASE_URL || 'https://api.razorpay.com/v1';

export const RAZORPAY_AUTH_BASE_URL =
  process.env.RAZORPAY_AUTH_BASE_URL || 'https://auth.razorpay.com';

/** Relative paths under RAZORPAY_API_BASE_URL. */
export const RAZORPAY_PATHS = {
  customers: '/customers',
  paymentLinks: '/payment_links',
  orders: '/orders',
  recurringPayment: '/payments/create/recurring',
  /** Mandate registration ("authorization transaction") link. */
  authLinks: '/subscription_registration/auth_links',
  customerToken: (customerId: string, tokenId: string) =>
    `/customers/${customerId}/tokens/${tokenId}`,
} as const;

export const RAZORPAY_OAUTH_PATHS = {
  authorize: '/authorize',
  token: '/token',
} as const;

/** OAuth scope the platform requests from a gym's Razorpay account. */
export const RAZORPAY_OAUTH_SCOPES = ['read_write'] as const;

/** How long an in-flight OAuth `state` stays redeemable. */
export const RAZORPAY_OAUTH_STATE_TTL_MS = 15 * 60 * 1_000;

/** Refresh an OAuth access token when it is this close to expiring. */
export const RAZORPAY_TOKEN_REFRESH_LEEWAY_MS = 60 * 1_000;

/** Header Razorpay signs its webhook payloads with. */
export const RAZORPAY_SIGNATURE_HEADER = 'x-razorpay-signature';

/** Route the platform exposes for Razorpay callbacks. */
export const RAZORPAY_WEBHOOK_PATH = 'webhooks/razorpay';

/**
 * Where the OAuth browser redirect lands. Must be registered verbatim in the
 * Razorpay Partner dashboard as the app's redirect URI.
 */
export const RAZORPAY_OAUTH_CALLBACK_PATH =
  'payment-provider/razorpay/callback';

/**
 * Events a gym must enable on its webhook. Shown in Settings → Razorpay and
 * documented in AUTOPAY_MANDATE_FLOW.md.
 */
export const RAZORPAY_WEBHOOK_EVENTS = [
  'payment_link.paid',
  'payment.captured',
  'payment.authorized',
  'payment.failed',
  'order.paid',
  'invoice.paid',
  'token.confirmed',
  'token.rejected',
  'token.paused',
  'token.cancelled',
] as const;

/** Event names we branch on, so no handler compares raw strings. */
export const RAZORPAY_EVENTS = {
  paymentLinkPaid: 'payment_link.paid',
  paymentCaptured: 'payment.captured',
  paymentAuthorized: 'payment.authorized',
  paymentFailed: 'payment.failed',
  orderPaid: 'order.paid',
  invoicePaid: 'invoice.paid',
  invoiceExpired: 'invoice.expired',
  paymentLinkExpired: 'payment_link.expired',
  tokenConfirmed: 'token.confirmed',
  tokenRejected: 'token.rejected',
  tokenPaused: 'token.paused',
  tokenCancelled: 'token.cancelled',
  authorizationRevoked: 'account.app.authorization_revoked',
} as const;

/** Payment states Razorpay reports back to us. */
export const RAZORPAY_PAYMENT_STATUS = {
  created: 'created',
  authorized: 'authorized',
  captured: 'captured',
  failed: 'failed',
} as const;

/** Mandate instruments a gym may collect. */
export const MANDATE_METHODS = ['upi', 'emandate', 'card', 'nach'] as const;
export type MandateMethod = (typeof MANDATE_METHODS)[number];

export const DEFAULT_MANDATE_METHOD: MandateMethod = 'upi';

/** "Charge at will" — the only frequency this platform's billing model needs. */
export const MANDATE_FREQUENCY = 'as_presented';

/**
 * Per-debit ceiling each instrument allows, in major currency units.
 * `null` = no scheme-level cap, so the computed ceiling is used as-is.
 */
export const MANDATE_MAX_AMOUNT_BY_METHOD: Record<
  MandateMethod,
  number | null
> = {
  upi: 100_000,
  emandate: 1_000_000,
  card: 1_000_000,
  nach: null,
};

export function isMandateMethod(value: unknown): value is MandateMethod {
  return (
    typeof value === 'string' &&
    (MANDATE_METHODS as readonly string[]).includes(value)
  );
}

/** Smallest-unit conversion (paise ↔ rupees). Razorpay talks in minor units. */
export const MINOR_UNITS_PER_MAJOR = 100;

export function toMinorUnits(amount: number): number {
  return Math.round(amount * MINOR_UNITS_PER_MAJOR);
}

export function fromMinorUnits(minor: unknown): number {
  const value = Number(minor);
  return value > 0 ? value / MINOR_UNITS_PER_MAJOR : 0;
}
