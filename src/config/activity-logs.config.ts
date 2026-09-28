/**
 * Activity logs — two layers:
 *
 * 1) Backend overall: ACTIVITY_LOGS_ENABLED (env). Master kill-switch for the
 *    whole server. Default OFF.
 * 2) Gym level (dynamic): each gym must be entitled (plan has ACTIVITY_LOGS
 *    OR SUPER_ADMIN unlock) AND activityLogsEnabled=true on that gym.
 *
 * Retention is also per-gym (activityLogRetentionDays).
 */
export function isActivityLogsEnabled(): boolean {
  const raw = (process.env.ACTIVITY_LOGS_ENABLED || '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
}

/** Default keep window when a gym unlocks activity logs (days). */
export const DEFAULT_ACTIVITY_LOG_RETENTION_DAYS = 30;

/** Hard caps SUPER_ADMIN can set per gym. */
export const MIN_ACTIVITY_LOG_RETENTION_DAYS = 7;
export const MAX_ACTIVITY_LOG_RETENTION_DAYS = 365;
