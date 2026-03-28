const MS_PER_DAY = 86400000;

/** Monday 00:00 UTC of ISO week 1 for the given ISO week-numbering year. */
function mondayOfISOWeek1(isoYear: number): Date {
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const dow = jan4.getUTCDay() || 7;
  const mon = new Date(jan4);
  mon.setUTCDate(jan4.getUTCDate() - (dow - 1));
  return mon;
}

/** ISO weeks in `isoYear` (52 or 53). */
function isoWeeksInISOYear(isoYear: number): number {
  const a = mondayOfISOWeek1(isoYear).getTime();
  const b = mondayOfISOWeek1(isoYear + 1).getTime();
  return Math.round((b - a) / (7 * MS_PER_DAY));
}

/** ISO week key `YYYY-Www` (UTC), sufficient for weekly quest resets and streaks. */
export function getISOWeekKey(date: Date = new Date()): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/** Prior ISO week key (UTC), including 53-week ISO years. */
export function previousISOWeekKey(weekKey: string): string | null {
  const m = weekKey.match(/^(\d{4})-W(\d{2})$/);
  if (!m) return null;
  let y = Number(m[1]);
  let w = Number(m[2]) - 1;
  if (w < 1) {
    y -= 1;
    w = isoWeeksInISOYear(y);
  }
  return `${y}-W${String(w).padStart(2, '0')}`;
}

/** Count consecutive weeks ending at `currentWeek` present in `set`. */
export function consecutiveWeeksEndingAt(currentWeek: string, weeks: Set<string>): number {
  let n = 0;
  let cursor: string | null = currentWeek;
  while (cursor && weeks.has(cursor)) {
    n += 1;
    cursor = previousISOWeekKey(cursor);
  }
  return n;
}
