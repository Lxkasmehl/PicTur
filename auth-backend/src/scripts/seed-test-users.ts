/**
 * Script to create test users for e2e tests
 *
 * Usage:
 *   npm run seed-test-users
 *
 * Or set environment variables:
 *   E2E_ADMIN_EMAIL=admin@test.com
 *   E2E_ADMIN_PASSWORD=testpassword123
 *   E2E_COMMUNITY_EMAIL=community@test.com
 *   E2E_COMMUNITY_PASSWORD=testpassword123
 *   E2E_STAFF_EMAIL=staff@test.com (optional)
 *   E2E_STAFF_PASSWORD=testpassword123 (optional)
 */

import db from '../db/database.js';
import bcrypt from 'bcryptjs';
import type { User } from '../types/user.js';

const adminEmail = process.env.E2E_ADMIN_EMAIL || 'admin@test.com';
const adminPassword = process.env.E2E_ADMIN_PASSWORD || 'testpassword123';
const communityEmail = process.env.E2E_COMMUNITY_EMAIL || 'community@test.com';
const communityPassword = process.env.E2E_COMMUNITY_PASSWORD || 'testpassword123';
const staffEmail = process.env.E2E_STAFF_EMAIL || 'staff@test.com';
const staffPassword = process.env.E2E_STAFF_PASSWORD || 'testpassword123';
const roleTestEmail =
  process.env.E2E_ROLE_TEST_EMAIL || 'role-test-community@test.com';
const roleTestPassword =
  process.env.E2E_ROLE_TEST_PASSWORD || 'testpassword123';

async function createUser(
  email: string,
  password: string,
  role: 'admin' | 'staff' | 'community',
  name: string | null = null
) {
  // Check if user already exists
  const existingUser = db
    .prepare('SELECT id, role FROM users WHERE email = ?')
    .get(email.toLowerCase()) as User | undefined;

  if (existingUser) {
    // Update role if different; ensure test user is email-verified so E2E login lands on /
    const now = new Date().toISOString();
    if (existingUser.role !== role) {
      db.prepare(
        'UPDATE users SET role = ?, updated_at = ? WHERE id = ?'
      ).run(role, now, existingUser.id);
      console.log(`✅ User ${email} updated to role: ${role}`);
    } else {
      console.log(`ℹ️  User ${email} already exists with role: ${role}`);
    }
    db.prepare(
      'UPDATE users SET email_verified = ?, email_verified_at = ?, updated_at = ? WHERE id = ?'
    ).run(1, now, now, existingUser.id);
    return;
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, 10);

  // Create user
  const result = db
    .prepare('INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)')
    .run(email.toLowerCase(), passwordHash, name, role);

  const now = new Date().toISOString();
  db.prepare(
    'UPDATE users SET email_verified = ?, email_verified_at = ?, updated_at = ? WHERE id = ?'
  ).run(1, now, now, result.lastInsertRowid);

  console.log(`✅ Created ${role} user: ${email} (ID: ${result.lastInsertRowid})`);
}

async function seedTestUsers() {
  try {
    console.log('🌱 Seeding test users for e2e tests...\n');

    // Create admin user
    await createUser(adminEmail, adminPassword, 'admin', 'Test Admin');

    // Create community user
    await createUser(communityEmail, communityPassword, 'community', 'Test Community');

    // Create staff user (same rights as admin except user management)
    await createUser(staffEmail, staffPassword, 'staff', 'Test Staff');

    // Dedicated user for "change role" E2E test (never use community@test.com so other tests are not affected)
    await createUser(roleTestEmail, roleTestPassword, 'community', 'Role Test');

    console.log('\n✅ Test users seeded successfully!');
    console.log(`   Admin: ${adminEmail}`);
    console.log(`   Staff: ${staffEmail}`);
    console.log(`   Community: ${communityEmail}`);
    console.log(`   Role test (community): ${roleTestEmail}`);
    console.log(`   Password: ${adminPassword} (same for all)\n`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding test users:', error);
    process.exit(1);
  }
}

seedTestUsers();
