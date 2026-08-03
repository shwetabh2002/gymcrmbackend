export enum MemberOnboardingStatus {
  ACTIVE = 'ACTIVE',
  AWAITING_MANDATE = 'AWAITING_MANDATE',
  DRAFT = 'DRAFT',
}

export enum BillingMode {
  MANUAL = 'MANUAL',
  AUTOPAY = 'AUTOPAY',
}

export enum MandateStatus {
  CREATED = 'CREATED',
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  CANCELLED = 'CANCELLED',
  REJECTED = 'REJECTED',
}

export enum PaymentSource {
  FRONT_DESK = 'FRONT_DESK',
  AUTOPAY = 'AUTOPAY',
  CHECKOUT = 'CHECKOUT',
}
