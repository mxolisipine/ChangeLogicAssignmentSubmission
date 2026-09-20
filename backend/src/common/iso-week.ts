/**
 * ISO 8601 week-key utilities.
 *
 * weekKey format: YYYY-Www  (e.g. "2026-W38")
 * ISO weeks start on Monday. Week 1 contains the first Thursday of the year.
 */

/**
 * Return the ISO week key for a given date (defaults to now).
 *
 * The algorithm shifts to the nearest Thursday to resolve the correct
 * ISO year + week number, then formats as YYYY-Www.
 */
export function currentISOWeek(date: Date = new Date()): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  // Move to the Thursday of this week (ISO day 4); Sunday = 0 → treat as 7
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}
