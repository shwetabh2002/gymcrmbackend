/**
 * Match recurring calendar events (birthday / anniversary) against "today" or "tomorrow"
 * in the server's local timezone (same as existing employee logic).
 */
export function isMonthDayTodayOrTomorrow(
  month: number,
  day: number,
  ref: Date = new Date(),
): boolean {
  const tM = ref.getMonth() + 1;
  const tD = ref.getDate();
  const tomorrow = new Date(ref);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tmM = tomorrow.getMonth() + 1;
  const tmD = tomorrow.getDate();
  return (
    (month === tM && day === tD) || (month === tmM && day === tmD)
  );
}

/** 0 = today, 1 = tomorrow (for sorting; filtered rows are only 0 or 1). */
export function todayOrTomorrowOrder(
  month: number,
  day: number,
  ref: Date = new Date(),
): number {
  const tM = ref.getMonth() + 1;
  const tD = ref.getDate();
  if (month === tM && day === tD) return 0;
  return 1;
}
