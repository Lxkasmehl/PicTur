// Load environment variables - ensure they're loaded even if this module is imported before index.ts
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file from auth-backend directory (same path as index.ts)
const envPath = path.join(__dirname, '../../.env');
dotenv.config({ path: envPath });

import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import db from '../db/database.js';
import type { User } from '../types/user.js';

// Build full callback URL from environment or use default
const getCallbackURL = (): string => {
  const baseURL =
    process.env.AUTH_BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`;
  return `${baseURL}/api/auth/google/callback`;
};

// Only configure Google OAuth if credentials are provided
const googleClientID = process.env.GOOGLE_CLIENT_ID?.trim();
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();

console.log('🔍 Checking Google OAuth configuration...');
console.log(
  'GOOGLE_CLIENT_ID:',
  googleClientID ? `${googleClientID.substring(0, 20)}...` : 'NOT SET'
);
console.log('GOOGLE_CLIENT_SECRET:', googleClientSecret ? 'SET' : 'NOT SET');

if (
  googleClientID &&
  googleClientSecret &&
  googleClientID !== '' &&
  googleClientSecret !== ''
) {
  const callbackURL = getCallbackURL();
  console.log('✅ Configuring Google OAuth...');
  console.log(`   Callback URL: ${callbackURL}`);
  console.log(
    '   ⚠️  Make sure this URL is added to Google Cloud Console as an authorized redirect URI'
  );
  passport.use(
    new GoogleStrategy(
      {
        clientID: googleClientID,
        clientSecret: googleClientSecret,
        callbackURL: callbackURL,
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          console.log('🔍 Google OAuth callback received:');
          console.log(`   Google ID: ${profile.id}`);
          console.log(`   Display Name: ${profile.displayName}`);
          console.log(`   Emails:`, profile.emails);

          const email = profile.emails?.[0]?.value;
          if (!email) {
            console.error('❌ No email provided by Google');
            return done(new Error('No email provided by Google'), undefined);
          }

          // Normalize email to lowercase for consistent comparison
          const emailLower = email.toLowerCase();
          console.log(`   Email: ${email} (normalized: ${emailLower})`);

          // Check if user exists with this Google ID
          let user = db
            .prepare('SELECT * FROM users WHERE google_id = ?')
            .get(profile.id) as (User & { password_hash?: string }) | undefined;

          console.log(
            `   User with Google ID ${profile.id}:`,
            user ? `Found (ID: ${user.id}, Email: ${user.email})` : 'Not found'
          );

          if (user) {
            // User exists with this Google ID - login
            console.log(`✅ Google OAuth: Existing user logged in (${emailLower})`);
            return done(null, user);
          }

          // Check if user exists with this email (case-insensitive, but different Google account or no Google account)
          user = db.prepare('SELECT * FROM users WHERE email = ?').get(emailLower) as
            | (User & { password_hash?: string })
            | undefined;

          console.log(
            `   User with email ${emailLower}:`,
            user
              ? `Found (ID: ${user.id}, Google ID: ${user.google_id || 'none'})`
              : 'Not found'
          );

          if (user) {
            // User exists with this email
            if (user.google_id === profile.id) {
              // Same Google ID - should have been caught above, but just in case
              console.log(`✅ Google OAuth: Existing user logged in (${emailLower})`);
              return done(null, user);
            } else if (user.google_id) {
              // User has a different Google ID - this shouldn't happen, but link it anyway
              console.log(
                `⚠️  Google OAuth: User exists with different Google ID. Linking new Google account to existing user (${emailLower})`
              );
              db.prepare('UPDATE users SET google_id = ? WHERE id = ?').run(
                profile.id,
                user.id
              );
            } else {
              // User exists but has no Google ID - link Google account
              console.log(
                `✅ Google OAuth: Linking Google account to existing user (${emailLower})`
              );
              db.prepare('UPDATE users SET google_id = ? WHERE id = ?').run(
                profile.id,
                user.id
              );
            }
            // Reload user to get updated data
            user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as User & {
              password_hash?: string;
            };
            console.log(`✅ User updated successfully`);
            return done(null, user);
          }

          // User doesn't exist - create new account (automatic signup)
          console.log(`✅ Google OAuth: Creating new user (${emailLower})`);

          try {
            const result = db
              .prepare(
                'INSERT INTO users (email, name, google_id, role) VALUES (?, ?, ?, ?)'
              )
              .run(emailLower, profile.displayName || null, profile.id, 'community');

            console.log(`   Insert result:`, result);
            console.log(`   Last insert rowid:`, result.lastInsertRowid);

            // Small delay to ensure database is written (for file system consistency)
            await new Promise((resolve) => setTimeout(resolve, 10));

            // Try to find by ID first (most reliable after insert)
            let newUser = db
              .prepare('SELECT * FROM users WHERE id = ?')
              .get(result.lastInsertRowid) as User & { password_hash?: string };

            console.log(
              `   New user from database (by ID ${result.lastInsertRowid}):`,
              newUser ? `Found (ID: ${newUser.id}, Email: ${newUser.email})` : 'NOT FOUND'
            );

            // If not found by ID, try by email
            if (!newUser) {
              newUser = db
                .prepare('SELECT * FROM users WHERE email = ?')
                .get(emailLower) as User & { password_hash?: string };
              console.log(
                `   New user from database (by email):`,
                newUser
                  ? `Found (ID: ${newUser.id}, Email: ${newUser.email})`
                  : 'NOT FOUND'
              );
            }

            if (!newUser) {
              console.error('❌ Failed to retrieve newly created user from database');
              console.error(
                `   Tried to find user with ID: ${result.lastInsertRowid}, Email: ${emailLower}`
              );

              // Last resort: create a user object manually from what we know
              const manualUser: User & { password_hash?: string } = {
                id: result.lastInsertRowid,
                email: emailLower,
                name: profile.displayName || null,
                google_id: profile.id,
                role: 'community',
                created_at: new Date().toISOString(),
                email_verified: true,
                email_verified_at: new Date().toISOString(),
              };
              console.log(`   Using manually constructed user object:`, manualUser);
              return done(null, manualUser);
            }

            return done(null, newUser);
          } catch (insertError: any) {
            // If insert fails due to duplicate, try to find the existing user
            if (insertError.message && insertError.message.includes('already exists')) {
              console.log(
                `   Insert failed due to duplicate, searching for existing user...`
              );
              // Try to find by email
              const existingUser = db
                .prepare('SELECT * FROM users WHERE email = ?')
                .get(emailLower) as User & { password_hash?: string };

              if (existingUser) {
                console.log(`   Found existing user: ID ${existingUser.id}`);
                // Link Google ID if not already linked
                if (!existingUser.google_id) {
                  db.prepare('UPDATE users SET google_id = ? WHERE id = ?').run(
                    profile.id,
                    existingUser.id
                  );
                  // Reload user
                  const updatedUser = db
                    .prepare('SELECT * FROM users WHERE id = ?')
                    .get(existingUser.id) as User & { password_hash?: string };
                  return done(null, updatedUser || existingUser);
                }
                return done(null, existingUser);
              }
            }
            // Re-throw if it's not a duplicate error
            throw insertError;
          }
        } catch (error) {
          console.error('❌ Google OAuth error:', error);
          return done(error, undefined);
        }
      }
    )
  );
  console.log('✅ Google OAuth configured successfully');
} else {
  console.warn(
    '⚠️  Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env to enable Google login.'
  );
}

passport.serializeUser((user: any, done) => {
  done(null, user.id);
});

passport.deserializeUser((id: number, done) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User & {
      password_hash?: string;
    };
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

export default passport;
