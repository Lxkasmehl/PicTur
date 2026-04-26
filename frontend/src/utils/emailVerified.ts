/**
 * Auth API may return boolean or SQLite-style 0/1 for email_verified.
 * Missing field: treat as verified (legacy sessions before the flag existed).
 */
export function isEmailVerified(user: {
  email_verified?: boolean | number | null;
}): boolean {
  const v = user.email_verified;
  if (v === undefined || v === null) return true;
  return v === true || v === 1;
}
