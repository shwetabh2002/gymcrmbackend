/**
 * The catalogue of transactional emails.
 *
 * Every type ships a default subject/body here. A gym may override either in
 * Settings → Email, and may switch a type off entirely. Placeholders are
 * `{name}` and are filled by `renderTemplate`.
 *
 * Adding an email = one entry here + one `sendTemplated` call. Nothing else.
 */

export const EMAIL_TYPES = {
  /** Gym owner just signed up on the marketing site. */
  gymWelcome: 'GYM_WELCOME',
  /** A member was added to the gym. */
  memberWelcome: 'MEMBER_WELCOME',
  /** Payment / UPI Autopay mandate link for a member to complete. */
  paymentLink: 'PAYMENT_LINK',
  /** A payment was recorded — receipt with invoice number. */
  paymentReceipt: 'PAYMENT_RECEIPT',
  /** A recurring debit failed. */
  autopayFailed: 'AUTOPAY_FAILED',
  /** The gym's own trial with us is running out. */
  trialEnding: 'TRIAL_ENDING',
  /** The trial ended without a payment method. */
  trialEnded: 'TRIAL_ENDED',
} as const;

export type EmailType = (typeof EMAIL_TYPES)[keyof typeof EMAIL_TYPES];

export const EMAIL_TYPE_LIST: EmailType[] = Object.values(EMAIL_TYPES);

export function isEmailType(value: unknown): value is EmailType {
  return (
    typeof value === 'string' && EMAIL_TYPE_LIST.includes(value as EmailType)
  );
}

export type EmailTemplateDefinition = {
  type: EmailType;
  /** Shown in the settings list. */
  label: string;
  description: string;
  /** Placeholders a gym may use in this template. */
  placeholders: string[];
  defaultSubject: string;
  defaultBody: string;
  /** Gym-editable templates only; platform mails stay locked. */
  editableByGym: boolean;
  /** Whether a fresh gym has this email switched on. */
  defaultEnabled: boolean;
};

/** Placeholders every template can use, in addition to its own. */
export const COMMON_PLACEHOLDERS = ['gymName', 'gymPhone', 'gymEmail'] as const;

export const EMAIL_TEMPLATES: Record<EmailType, EmailTemplateDefinition> = {
  [EMAIL_TYPES.gymWelcome]: {
    type: EMAIL_TYPES.gymWelcome,
    label: 'Gym owner welcome',
    description:
      'Sent to the owner right after signup, with their login details.',
    placeholders: ['adminName', 'email', 'password', 'loginUrl'],
    defaultSubject: 'Welcome to {gymName} on GymFlow',
    defaultBody: [
      'Hi {adminName},',
      '',
      'Your gym workspace "{gymName}" is ready.',
      '',
      'Login details',
      'Email: {email}',
      'Password: {password}',
      '',
      'Open your CRM: {loginUrl}',
      '',
      'For security, change your password after you sign in.',
    ].join('\n'),
    // Platform-owned: a gym cannot rewrite the mail that carries its own
    // first credentials, because it does not exist yet when this is sent.
    editableByGym: false,
    defaultEnabled: true,
  },

  [EMAIL_TYPES.memberWelcome]: {
    type: EMAIL_TYPES.memberWelcome,
    label: 'Member welcome',
    description: 'Sent when a new member is added, with their plan details.',
    placeholders: [
      'memberName',
      'memberId',
      'planName',
      'startDate',
      'expiryDate',
      'amount',
    ],
    defaultSubject: 'Welcome to {gymName}, {memberName}!',
    defaultBody: [
      'Hi {memberName},',
      '',
      'Welcome to {gymName}. Your membership is active.',
      '',
      'Member ID: {memberId}',
      'Plan: {planName}',
      'Valid: {startDate} to {expiryDate}',
      '',
      'See you at the gym!',
      '{gymName} · {gymPhone}',
    ].join('\n'),
    editableByGym: true,
    defaultEnabled: true,
  },

  [EMAIL_TYPES.paymentLink]: {
    type: EMAIL_TYPES.paymentLink,
    label: 'Payment / autopay link',
    description:
      'Sent with the payment or UPI Autopay mandate link, alongside WhatsApp.',
    placeholders: ['memberName', 'amount', 'payUrl', 'planName'],
    defaultSubject: 'Complete your payment for {gymName}',
    defaultBody: [
      'Hi {memberName},',
      '',
      'Please complete your payment of {amount} for {planName}.',
      '',
      'Pay here: {payUrl}',
      '',
      'The link stays valid for one hour.',
      '',
      '{gymName} · {gymPhone}',
    ].join('\n'),
    editableByGym: true,
    defaultEnabled: true,
  },

  [EMAIL_TYPES.paymentReceipt]: {
    type: EMAIL_TYPES.paymentReceipt,
    label: 'Payment receipt',
    description: 'Sent after a payment is recorded, with the invoice number.',
    placeholders: [
      'memberName',
      'amount',
      'invoiceNumber',
      'paymentDate',
      'paymentMode',
    ],
    defaultSubject: 'Payment received — {invoiceNumber}',
    defaultBody: [
      'Hi {memberName},',
      '',
      'We have received {amount} on {paymentDate}.',
      '',
      'Invoice: {invoiceNumber}',
      'Mode: {paymentMode}',
      '',
      'Thank you.',
      '{gymName} · {gymPhone}',
    ].join('\n'),
    editableByGym: true,
    defaultEnabled: true,
  },

  [EMAIL_TYPES.autopayFailed]: {
    type: EMAIL_TYPES.autopayFailed,
    label: 'Autopay failed',
    description: 'Sent when a recurring debit could not be collected.',
    placeholders: ['memberName', 'amount', 'reason'],
    defaultSubject: 'Autopay could not be collected — {gymName}',
    defaultBody: [
      'Hi {memberName},',
      '',
      'Your autopay of {amount} could not be collected.',
      '',
      'Please visit the gym or retry the payment so your membership stays active.',
      '',
      '{gymName} · {gymPhone}',
    ].join('\n'),
    editableByGym: true,
    defaultEnabled: true,
  },

  [EMAIL_TYPES.trialEnding]: {
    type: EMAIL_TYPES.trialEnding,
    label: 'Trial ending',
    description:
      'Reminds the gym owner their trial with us is about to end. Platform-owned.',
    placeholders: [
      'adminName',
      'daysLeft',
      'trialEndsAt',
      'planCode',
      'billingUrl',
    ],
    defaultSubject: 'Your GymFlow trial ends in {daysLeft} days',
    defaultBody: [
      'Hi {adminName},',
      '',
      'Your free trial ends on {trialEndsAt} — {daysLeft} days from now.',
      '',
      'Pick a plan to keep adding members and taking payments:',
      '{billingUrl}',
      '',
      'Your data stays safe either way.',
    ].join('\n'),
    // Ours, not the gym's: a gym should not be able to rewrite or switch off
    // the notice that its own account is lapsing.
    editableByGym: false,
    defaultEnabled: true,
  },

  [EMAIL_TYPES.trialEnded]: {
    type: EMAIL_TYPES.trialEnded,
    label: 'Trial ended',
    description:
      'Tells the gym owner the trial has ended and the account is read-only. Platform-owned.',
    placeholders: ['adminName', 'billingUrl'],
    defaultSubject: 'Your GymFlow trial has ended',
    defaultBody: [
      'Hi {adminName},',
      '',
      'Your trial has ended. Everything you added is still there and still',
      'readable — you just cannot add new members or take payments until you',
      'pick a plan.',
      '',
      'Choose a plan: {billingUrl}',
    ].join('\n'),
    editableByGym: false,
    defaultEnabled: true,
  },
};

/** Types a gym is allowed to edit in Settings. */
export const GYM_EDITABLE_EMAIL_TYPES = EMAIL_TYPE_LIST.filter(
  (type) => EMAIL_TEMPLATES[type].editableByGym,
);

/** Replaces every `{key}`; unknown keys are dropped so no `{raw}` ever ships. */
export function renderTemplate(
  template: string,
  values: Record<string, string | number | undefined | null>,
): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = values[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

/** Placeholder list shown in the settings UI for one type. */
export function placeholdersFor(type: EmailType): string[] {
  return [...COMMON_PLACEHOLDERS, ...EMAIL_TEMPLATES[type].placeholders];
}
