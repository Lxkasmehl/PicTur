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

/**
 * Live-typing input mask: strips non-digits and re-inserts slashes as MM/DD/YYYY
 * (e.g. "01272026" while typing → "01/27/2026"). Used for single-date text inputs.
 */
export function maskUsDateInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  let out = digits.slice(0, 2);
  if (digits.length > 2) out += `/${digits.slice(2, 4)}`;
  if (digits.length > 4) out += `/${digits.slice(4, 8)}`;
  return out;
}

/**
 * Live-typing input mask for comma-separated fields (e.g. "Dates refound", or
 * "DNA Extracted?" which mixes dates with free text like "Yes"/"No"). Each
 * comma-separated segment is masked to MM/DD/YYYY unless it contains letters,
 * in which case it's left untouched so words like "Yes"/"No"/"N/A" still work.
 */
export function maskUsMultiDateInput(raw: string): string {
  return raw
    .split(',')
    .map((segment) => {
      const trimmed = segment.replace(/^\s+/, '');
      if (/[a-zA-Z]/.test(trimmed)) return trimmed;
      return maskUsDateInput(trimmed);
    })
    .join(', ');
}

/**
 * Cursor-position helpers for the mask functions above.
 * A masked string keeps the same digits/letters/commas in the same relative
 * order as the raw input — each comma the user types maps to exactly one
 * comma in the output; only slashes and the space after a comma get added or
 * removed. So to keep the caret in place across a re-mask, count how many of
 * these "kept" characters (alphanumeric or comma) precede the caret in the
 * raw value, then place the caret right after that same count of kept
 * characters in the masked value — landing after a just-typed comma instead
 * of before it.
 */
const KEPT_CHAR = /[a-zA-Z0-9,]/;

function countKeptChars(s: string): number {
  return (s.match(new RegExp(KEPT_CHAR, 'g')) || []).length;
}

export function cursorPosForAlnumCount(masked: string, count: number): number {
  if (count <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < masked.length; i++) {
    if (KEPT_CHAR.test(masked[i])) {
      seen++;
      if (seen === count) return i + 1;
    }
  }
  return masked.length;
}

export function alnumCountBeforeCursor(raw: string, cursor: number): number {
  return countKeptChars(raw.slice(0, cursor));
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
