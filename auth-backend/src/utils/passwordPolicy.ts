/**
 * Password policy: minimum length, complexity, and common-password check.
 * Used at registration and password change.
 */

const MIN_LENGTH = 10;
const MAX_LENGTH = 128;

/** Require at least one of each: uppercase, lowercase, digit, special character */
function hasRequiredCharacterClasses(password: string): boolean {
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasSpecial = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password);
  return hasUpper && hasLower && hasDigit && hasSpecial;
}

/** Top common passwords (subset) – reject these. Source: SecLists / common lists. */
const COMMON_PASSWORDS = new Set(
  [
    'password', '123456', '12345678', 'qwerty', 'abc123', 'monkey', '1234567',
    'letmein', 'trustno1', 'dragon', 'baseball', 'iloveyou', 'master', 'sunshine',
    'ashley', 'bailey', 'passw0rd', 'shadow', '123123', '654321', 'superman',
    'qazwsx', 'michael', 'football', 'password1', 'password123', 'admin', 'login',
    'welcome', 'admin123', 'root', 'pass', 'test', 'guest', '1234', '12345',
    '123456789', '1234567890', 'qwerty123', 'password2', 'admin1', 'welcome1',
    'Password1', 'Password123', 'Admin123', 'Letmein1', 'Qwerty123', 'Welcome1',
    'TurtleTracker', 'turtle', 'turtle123',
  ].map((p) => p.toLowerCase())
);

function isCommonPassword(password: string): boolean {
  const normalized = password.trim().toLowerCase();
  if (COMMON_PASSWORDS.has(normalized)) return true;
  // Also reject if it's a common password with a simple suffix (e.g. password1)
  for (const common of COMMON_PASSWORDS) {
    if (normalized === common || normalized.startsWith(common + '1') || normalized.startsWith(common + '123')) {
      return true;
    }
  }
  return false;
}

export interface PasswordValidationResult {
  valid: boolean;
  message?: string;
}

/**
 * Validate password against policy.
 * Returns { valid: true } or { valid: false, message: "..." }.
 */
export function validatePassword(password: string): PasswordValidationResult {
  if (typeof password !== 'string') {
    return { valid: false, message: 'Password must be a string' };
  }

  const trimmed = password.trim();
  if (trimmed.length < MIN_LENGTH) {
    return {
      valid: false,
      message: `Password must be at least ${MIN_LENGTH} characters long`,
    };
  }

  if (trimmed.length > MAX_LENGTH) {
    return {
      valid: false,
      message: `Password must be at most ${MAX_LENGTH} characters`,
    };
  }

  if (!hasRequiredCharacterClasses(trimmed)) {
    return {
      valid: false,
      message:
        'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character (!@#$%^&* etc.)',
    };
  }

  if (isCommonPassword(trimmed)) {
    return {
      valid: false,
      message: 'This password is too common. Please choose a stronger password.',
    };
  }

  return { valid: true };
}
