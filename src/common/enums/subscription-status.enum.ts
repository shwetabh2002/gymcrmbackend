export enum SubscriptionStatus {
  ACTIVE = 'ACTIVE',
  EXPIRING_SOON = 'EXPIRING_SOON',
  EXPIRED = 'EXPIRED',
  /** Closed because a newer plan was assigned (renew / replace) — not a voluntary cancel. */
  ENDED = 'ENDED',
  CANCELLED = 'CANCELLED',
}
