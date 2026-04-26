/**
 * Script to create the initial admin user
 * 
 * Usage:
 *   npm run create-admin <email> <password> [name]
 * 
 * Or set environment variables:
 *   INITIAL_ADMIN_EMAIL=admin@example.com
 *   INITIAL_ADMIN_PASSWORD=securepassword
 *   INITIAL_ADMIN_NAME="Admin User"
 */

import db from '../db/database.js';
import bcrypt from 'bcryptjs';
import type { User } from '../types/user.js';

const email = process.env.INITIAL_ADMIN_EMAIL || process.argv[2];
const password = process.env.INITIAL_ADMIN_PASSWORD || process.argv[3];
const name = process.env.INITIAL_ADMIN_NAME || process.argv[4] || null;

if (!email || !password) {
  console.error('Error: Email and password are required');
  console.error('');
  console.error('Usage:');
  console.error('  npm run create-admin <email> <password> [name]');
  console.error('');
  console.error('Or set environment variables:');
  console.error('  INITIAL_ADMIN_EMAIL=admin@example.com');
  console.error('  INITIAL_ADMIN_PASSWORD=securepassword');
  console.error('  INITIAL_ADMIN_NAME="Admin User"');
  process.exit(1);
}

async function createInitialAdmin() {
  try {
    // Check if user already exists
    const existingUser = db
      .prepare('SELECT id, role FROM users WHERE email = ?')
      .get(email.toLowerCase()) as User | undefined;

    if (existingUser) {
      if (existingUser.role === 'admin') {
        console.log(`User ${email} already exists and is already an admin.`);
        process.exit(0);
      } else {
        // Update existing user to admin
        db.prepare('UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
          'admin',
          existingUser.id
        );
        console.log(`User ${email} has been promoted to admin.`);
        process.exit(0);
      }
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create admin user (verified so admin flows work)
    const now = new Date().toISOString();
    const result = db
      .prepare(
        `INSERT INTO users (email, password_hash, name, role, email_verified, email_verified_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?)`
      )
      .run(email.toLowerCase(), passwordHash, name, 'admin', now, now, now);

    console.log('✅ Initial admin user created successfully!');
    console.log(`   Email: ${email}`);
    console.log(`   Name: ${name || 'Not set'}`);
    console.log(`   Role: admin`);
    console.log(`   ID: ${Number(result.lastInsertRowid)}`);
    console.log('');
    console.log('You can now log in with these credentials.');

    process.exit(0);
  } catch (error) {
    console.error('Error creating admin user:', error);
    process.exit(1);
  }
}

createInitialAdmin();

