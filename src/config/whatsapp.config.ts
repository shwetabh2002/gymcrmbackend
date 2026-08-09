/**
 * WhatsApp hosts and message copy.
 *
 * Copy lives here rather than inline in the service so wording can be reviewed
 * (and later localised) without touching delivery logic. `{placeholders}` are
 * filled by `renderTemplate`.
 */

/** Meta Graph API — pin the version so a rollout cannot change behaviour silently. */
export const WHATSAPP_GRAPH_API_VERSION =
  process.env.WHATSAPP_GRAPH_API_VERSION || 'v19.0';

export const WHATSAPP_GRAPH_API_BASE_URL =
  process.env.WHATSAPP_GRAPH_API_BASE_URL || 'https://graph.facebook.com';

export function whatsappSendMessageUrl(phoneNumberId: string): string {
  return `${WHATSAPP_GRAPH_API_BASE_URL}/${WHATSAPP_GRAPH_API_VERSION}/${phoneNumberId}/messages`;
}

/** click-to-chat host used for the manual-share fallback. */
export const WHATSAPP_SHARE_BASE_URL = 'https://wa.me';

export function whatsappShareUrl(
  internationalDigits: string,
  message: string,
): string {
  return `${WHATSAPP_SHARE_BASE_URL}/${internationalDigits}?text=${encodeURIComponent(message)}`;
}

/** Fewer digits than this cannot be a deliverable international number. */
export const MIN_PHONE_DIGITS = 10;

/** Shown when a gym has not set its display name yet. */
export const FALLBACK_GYM_NAME = 'your gym';

export const WHATSAPP_TEMPLATES = {
  membershipPayment:
    'Hi {memberName},\n\n' +
    'Please complete your membership payment of {amount} for {gymName}.\n\n' +
    'Pay / approve autopay here:\n{payUrl}\n\n' +
    'Thank you!',

  autopayFailed:
    'Hi {memberName}, your autopay of {amount} failed. ' +
    'Please visit the gym or retry payment. Thank you.',
} as const;

/** Replaces every `{key}` with its value; unknown keys are left untouched. */
export function renderTemplate(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}
