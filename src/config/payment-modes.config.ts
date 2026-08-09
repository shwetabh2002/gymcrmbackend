import { PaymentMode } from '../common/enums/payment-mode.enum';

/**
 * How the front desk collects money when onboarding or renewing a member.
 *
 * This is a *collection* choice, not a ledger field:
 *   CASH    → staff fills the amount they took in hand
 *   ONLINE  → staff fills an online transfer the member already made (UPI/card/
 *             netbanking); a reference can be recorded
 *   AUTOPAY → no manual fill: a mandate registration link goes to the member,
 *             and every later renewal is debited automatically
 */
export const COLLECTION_MODES = ['CASH', 'ONLINE', 'AUTOPAY'] as const;
export type CollectionMode = (typeof COLLECTION_MODES)[number];

export const DEFAULT_COLLECTION_MODE: CollectionMode = 'CASH';

export function isCollectionMode(value: unknown): value is CollectionMode {
  return (
    typeof value === 'string' &&
    (COLLECTION_MODES as readonly string[]).includes(value)
  );
}

/**
 * Ledger values a *new* payment may be recorded with.
 *
 * The PaymentMode enum keeps UPI / CARD / BANK_TRANSFER so historical rows stay
 * readable, but new payments only ever use these two — an autopay debit is an
 * ONLINE payment whose `source` is AUTOPAY.
 */
export const ACTIVE_PAYMENT_MODES: PaymentMode[] = [
  PaymentMode.CASH,
  PaymentMode.ONLINE,
];

/** Ledger mode a collection choice writes. */
export const LEDGER_MODE_BY_COLLECTION: Record<CollectionMode, PaymentMode> = {
  CASH: PaymentMode.CASH,
  ONLINE: PaymentMode.ONLINE,
  AUTOPAY: PaymentMode.ONLINE,
};

/** Labels shared with the CRM so both sides name things identically. */
export const COLLECTION_MODE_LABELS: Record<CollectionMode, string> = {
  CASH: 'Cash',
  ONLINE: 'Online (manual entry)',
  AUTOPAY: 'UPI Autopay (mandate)',
};
