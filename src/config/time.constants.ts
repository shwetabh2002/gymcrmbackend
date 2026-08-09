/**
 * Durations in milliseconds.
 *
 * Every timeout, window and interval in the codebase is expressed with these so
 * a reader never has to decode `20 * 60 * 60 * 1000` at the call site.
 */
export const SECOND_MS = 1_000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** Whole days between two instants, rounded up (used for "days remaining"). */
export function daysBetween(from: Date, to: Date): number {
  return Math.ceil((to.getTime() - from.getTime()) / DAY_MS);
}

/** `date` shifted by whole days. Negative goes back in time. */
export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** Unix seconds — the format Razorpay and most payment APIs expect. */
export function toUnixSeconds(date: Date): number {
  return Math.floor(date.getTime() / SECOND_MS);
}

/** `YYYY-MM-DD` in UTC — the shape our payment/invoice date fields use. */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
