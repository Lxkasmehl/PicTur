/**
 * Grant or revoke platform-level super admin rights (create research groups, assign their admins).
 *
 * Usage:
 *   npm run set-super-admin -- you@example.com
 *   npm run set-super-admin -- you@example.com --revoke
 *
 * Alternatively set SUPER_ADMIN_EMAILS (comma-separated) in the environment; it is applied on start.
 */

import db from '../db/database.js';

const emailArg = process.argv[2];
const revoke = process.argv.includes('--revoke');
if (!emailArg) {
  console.error('Usage: npm run set-super-admin -- <email> [--revoke]');
  process.exit(1);
}

const emailLower = emailArg.trim().toLowerCase();
const result = db
  .prepare('UPDATE users SET is_super_admin = ? WHERE email = ?')
  .run(revoke ? 0 : 1, emailLower);

if (result.changes === 0) {
  console.error(`No user found with email: ${emailLower} (the account must exist first)`);
  process.exit(1);
}
console.log(`${revoke ? 'Revoked' : 'Granted'} super admin rights for ${emailLower}`);
