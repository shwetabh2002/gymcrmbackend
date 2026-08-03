export enum PaymentProvider {
  RAZORPAY = 'RAZORPAY',
}

export enum PaymentProviderAccountStatus {
  NOT_CONNECTED = 'NOT_CONNECTED',
  CONNECTED = 'CONNECTED',
  NEEDS_REAUTH = 'NEEDS_REAUTH',
  REVOKED = 'REVOKED',
}

export enum PaymentProviderAuthMode {
  OAUTH = 'OAUTH',
  /** Dev/fallback until Partner OAuth is approved — secrets encrypted at rest */
  API_KEYS = 'API_KEYS',
  MOCK = 'MOCK',
}
