/**
 * Test setup script that seeds test users and then starts the server
 * This is used by Playwright to ensure test users exist before tests run
 */

import db from '../db/database.js';
import bcrypt from 'bcryptjs';
import type { User } from '../types/user.js';

const adminEmail = process.env.E2E_ADMIN_EMAIL || 'admin@test.com';
const adminPassword = process.env.E2E_ADMIN_PASSWORD || 'testpassword123';
const communityEmail = process.env.E2E_COMMUNITY_EMAIL || 'community@test.com';
const communityPassword = process.env.E2E_COMMUNITY_PASSWORD || 'testpassword123';

async function createUser(
  email: string,
  password: string,
  role: 'admin' | 'community',
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

    console.log('\n✅ Test users seeded successfully!');
    console.log(`   Admin: ${adminEmail}`);
    console.log(`   Community: ${communityEmail}`);
    console.log(`   Password: ${adminPassword} (same for both)\n`);

    // Exit successfully so the next command (npm run dev) can run
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding test users:', error);
    process.exit(1);
  }
}

seedTestUsers();
