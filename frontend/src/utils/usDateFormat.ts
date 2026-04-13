/**
 * Display and normalize calendar dates as MM/DD/YYYY (US) with slashes.
 * Used so the UI does not follow the browser/OS locale (e.g. DD/MM/YYYY).
 */

import type { TurtleSheetsData } from '../services/api';

/** Sheet-backed fields that should be shown and stored in US slash date form when possible. */
export const TURTLE_SHEETS_DATE_FIELD_KEYS: (keyof TurtleSheetsData)[] = [
  'date_1st_found',
  'last_assay_date',
  'dates_refound',
  'transmitter_on_date',
  'radio_replace_date',
  'ibutton_last_set',
];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Calendar date in local time → MM/DD/YYYY */
export function formatLocalDateUsSlash(d: Date): string {
  return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}/${d.getFullYear()}`;
}

/** Typical photo / API timestamps → MM/DD/YYYY, h:mm:ss AM/PM (en-US clock) */
export function formatUsDateTimeForDisplay(d: Date): string {
  const datePart = formatLocalDateUsSlash(d);
  const timePart = d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
  return `${datePart}, ${timePart}`;
}

/**
 * Parse a single date token to a local calendar Date, or null if not recognized.
 * Slash dates: if the first number is > 12, treat as D/M/Y; if the second is > 12, as M/D/Y;
 * if both ≤ 12, assume US (M/D/Y).
 */
export function parseFlexibleDateToken(raw: string): Date | null {
  const t = raw.trim();
  if (!t) return null;

  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const y = +m[1];
    const mo = +m[2];
    const d = +m[3];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      const dt = new Date(y, mo - 1, d);
      if (dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d) return dt;
    }
  }

  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    const y = +m[3];
    let mo: number;
    let d: number;
    if (a > 12) {
      d = a;
      mo = b;
    } else if (b > 12) {
      mo = a;
      d = b;
    } else {
      mo = a;
      d = b;
    }
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      const dt = new Date(y, mo - 1, d);
      if (dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d) return dt;
    }
  }

  m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) {
    const d = +m[1];
    const mo = +m[2];
    const y = +m[3];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      const dt = new Date(y, mo - 1, d);
      if (dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d) return dt;
    }
  }

  return null;
}

export function formatSingleDateTokenToUs(raw: string): string {
  const d = parseFlexibleDateToken(raw);
  if (!d) return raw.trim();
  return formatLocalDateUsSlash(d);
}

/**
 * Normalize a refound-dates string to US slash form, joining with ", ".
 * Splits on commas and semicolons, then on whitespace within each segment so
 * legacy values like "2021-06-15 2022-07-04" keep every date (not only the first).
 */
export function formatCommaSeparatedDatesToUs(raw: string): string {
  const tokens = raw
    .split(/[,;]+/)
    .flatMap((segment) => segment.trim().split(/\s+/).filter(Boolean));
  return tokens.map((p) => formatSingleDateTokenToUs(p)).join(', ');
}

export function normalizeTurtleSheetsDateFieldsToUs(data: TurtleSheetsData): TurtleSheetsData {
  const out: TurtleSheetsData = { ...data };
  for (const key of TURTLE_SHEETS_DATE_FIELD_KEYS) {
    const raw = out[key];
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (key === 'dates_refound') {
      (out as Record<string, string>)[key] = formatCommaSeparatedDatesToUs(trimmed);
    } else {
      (out as Record<string, string>)[key] = formatSingleDateTokenToUs(trimmed);
    }
  }
  return out;
}
