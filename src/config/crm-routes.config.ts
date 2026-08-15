/**
 * Paths inside the CRM app that the API redirects or links to.
 *
 * Keeping them here means a route rename in the frontend is one edit on this
 * side, instead of a string hidden inside a controller or an email template.
 * Always combine with `RuntimeService.crmUrl()` — never hardcode the origin.
 */
export const CRM_ROUTES = {
  login: 'login',
  settings: 'settings',
  members: 'users',
  renewals: 'renewals',
  billing: 'billing',
  subscription: 'settings/subscription',
  /** Where the signup handoff drops the browser with its tokens. */
  authCallback: 'auth/callback',
} as const;

/** Query keys the CRM reads off those redirects. */
export const CRM_QUERY = {
  checkoutSession: 'checkout',
  paid: 'paid',
  razorpay: 'razorpay',
} as const;
