/**
 * `notes` is the only payload Razorpay echoes back to us on every webhook, so it
 * is how a callback is tied to a tenant, a checkout session and a charge intent.
 *
 * Writer (checkout / autopay worker) and reader (webhook controller) must agree
 * exactly — hence one shared vocabulary instead of inline string literals.
 */
export const PAYMENT_NOTE_KEYS = {
  companyId: 'companyId',
  sessionId: 'sessionId',
  draftMemberId: 'draftMemberId',
  memberId: 'memberId',
  subscriptionId: 'subscriptionId',
  planId: 'planId',
  tokenId: 'tokenId',
  authLinkId: 'authLinkId',
  paymentId: 'paymentId',
  enableAutopay: 'enableAutopay',
  /** Which part of the system started this charge. */
  source: 'source',
  /** What the charge is for — see CHARGE_KINDS. */
  kind: 'kind',
} as const;

/** Values for PAYMENT_NOTE_KEYS.source — mirrors PaymentSource on the ledger. */
export const PAYMENT_NOTE_SOURCE = {
  checkout: 'CHECKOUT',
  autopay: 'AUTOPAY',
} as const;

/** Values for PAYMENT_NOTE_KEYS.kind. */
export const CHARGE_KINDS = {
  /** First payment that also registers a mandate. */
  mandate: 'MANDATE',
  /** Collecting an outstanding balance in the current cycle. */
  dues: 'DUES',
  /** Charging the next cycle's price. */
  renewal: 'RENEWAL',
} as const;

export type ChargeKind = (typeof CHARGE_KINDS)[keyof typeof CHARGE_KINDS];

/** Boolean flags travel as '1' / '0' because Razorpay notes are strings only. */
export const NOTE_TRUE = '1';
export const NOTE_FALSE = '0';

export function noteFlag(value: boolean): string {
  return value ? NOTE_TRUE : NOTE_FALSE;
}
