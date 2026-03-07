/**
 * Password strength and requirements for UI.
 * Matches backend policy: min 10, max 128 chars; upper, lower, digit, special.
 */

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

const hasUpper = (s: string) => /[A-Z]/.test(s);
const hasLower = (s: string) => /[a-z]/.test(s);
const hasDigit = (s: string) => /\d/.test(s);
const hasSpecial = (s: string) =>
  /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(s);

export interface PasswordRequirements {
  length: boolean;
  lengthValid: boolean; // not over max
  upper: boolean;
  lower: boolean;
  digit: boolean;
  special: boolean;
}

export type PasswordStrength = 'empty' | 'weak' | 'fair' | 'good' | 'strong';

export function getPasswordRequirements(password: string): PasswordRequirements {
  const len = password.length;
  return {
    length: len >= PASSWORD_MIN_LENGTH,
    lengthValid: len <= PASSWORD_MAX_LENGTH,
    upper: hasUpper(password),
    lower: hasLower(password),
    digit: hasDigit(password),
    special: hasSpecial(password),
  };
}

/** All requirements met (matches backend validation, except common-password which is server-side). */
export function meetsAllRequirements(password: string): boolean {
  const r = getPasswordRequirements(password);
  return (
    r.length &&
    r.lengthValid &&
    r.upper &&
    r.lower &&
    r.digit &&
    r.special
  );
}

/** Strength level for progress bar: 0–4. */
export function getPasswordStrengthLevel(password: string): number {
  if (!password.length) return 0;
  const req = getPasswordRequirements(password);
  let score = 0;
  if (req.length) score += 1;
  if (req.upper) score += 1;
  if (req.lower) score += 1;
  if (req.digit) score += 1;
  if (req.special) score += 1;
  // Bonus for longer password (capped at 4 for display)
  if (password.length >= 16) score = Math.min(4, score + 1);
  return Math.min(4, score);
}

export function getPasswordStrengthLabel(
  password: string
): PasswordStrength {
  const level = getPasswordStrengthLevel(password);
  if (level === 0) return 'empty';
  if (level === 1) return 'weak';
  if (level === 2) return 'fair';
  if (level === 3) return 'good';
  return 'strong';
}
