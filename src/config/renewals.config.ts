/**
 * Windows that define "expiring soon" and "recently expired".
 *
 * Shared by the renewals queue and the dashboard so a member counted as
 * expiring in one screen is never counted differently in the other.
 * Callers may still pass explicit windows; these are the defaults.
 */

/** Treated as "expiring soon" — drives the follow-up queue and dashboard tile. */
export const EXPIRY_SOON_DAYS = 7;

/** How far back an expired subscription still shows up for win-back. */
export const EXPIRY_WINDOW_DAYS = 30;
