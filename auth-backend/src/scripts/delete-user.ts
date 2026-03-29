/**
 * Delete a user by email (SQLite CASCADE removes email_verifications, community_game, etc.).
 *
 * Usage:
 *   npm run delete-user -- you@example.com
 *
 * Refuses to delete the last remaining admin account.
 */

import db from '../db/database.js';

const emailArg = process.argv[2];
if (!emailArg) {
  console.error('Usage: npm run delete-user -- <email>');
  process.exit(1);
}

const emailLower = emailArg.trim().toLowerCase();
const row = db
  .prepare('SELECT id, email, role FROM users WHERE email = ?')
  .get(emailLower) as { id: number; email: string; role: string } | undefined;

if (!row) {
  console.error(`No user found with email: ${emailLower}`);
  process.exit(1);
}

if (row.role === 'admin') {
  const admins = db.prepare('SELECT id FROM users WHERE role = ?').all('admin') as { id: number }[];
  if (admins.length <= 1) {
    console.error('Refusing to delete the last admin. Promote another admin first.');
    process.exit(1);
  }
}

db.prepare('DELETE FROM users WHERE id = ?').run(row.id);
console.log(`Deleted user id=${row.id} email=${row.email}`);
