import express, { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import db from '../db/database.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { validatePassword } from '../utils/passwordPolicy.js';
import { sendVerificationEmail } from '../services/email.js';
import type { RegisterRequest, LoginRequest, User } from '../types/user.js';

const router = express.Router();
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const VERIFICATION_EXPIRY_HOURS = 24;

// Register new user
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, name, token }: RegisterRequest & { token?: string } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    // Check if user already exists (case-insensitive email check)
    const emailLower = email.toLowerCase();
    const existingUser = db
      .prepare('SELECT id FROM users WHERE email = ?')
      .get(emailLower) as User | undefined;

    if (existingUser) {
      res.status(409).json({ error: 'User with this email already exists' });
      return;
    }

    // Enforce password policy
    const passwordCheck = validatePassword(password);
    if (!passwordCheck.valid) {
      res.status(400).json({ error: passwordCheck.message });
      return;
    }

    // Check if there's a valid admin invitation token
    let role: 'community' | 'admin' = 'community';
    if (token) {
      const invitation = db
        .prepare(
          'SELECT * FROM admin_invitations WHERE token = ? AND used = 0 AND expires_at > datetime("now")'
        )
        .get(token) as any;

      if (invitation && invitation.email.toLowerCase() === email.toLowerCase()) {
        role = 'admin';
        // Mark invitation as used
        db.prepare('UPDATE admin_invitations SET used = 1 WHERE token = ?').run(token);
      } else if (invitation) {
        res.status(400).json({
          error: 'Invitation token is valid but for a different email address',
        });
        return;
      } else {
        res.status(400).json({ error: 'Invalid or expired invitation token' });
        return;
      }
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Normalize email to lowercase for storage
    const emailNormalized = email.toLowerCase();

    // Insert user with appropriate role
    const result = db
      .prepare(
        'INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)'
      )
      .run(emailNormalized, passwordHash, name || null, role);

    // Reload database to ensure we have the latest data
    const user = db
      .prepare('SELECT id, email, name, role, google_id, created_at, email_verified, email_verified_at FROM users WHERE id = ?')
      .get(result.lastInsertRowid) as User;

    if (!user) {
      console.error('Failed to retrieve newly created user from database');
      console.error(`   Tried to find user with ID: ${result.lastInsertRowid}, Email: ${emailNormalized}`);
      res.status(500).json({ error: 'Failed to create user account' });
      return;
    }

    // Create email verification token and send verification email
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + VERIFICATION_EXPIRY_HOURS);
    db.prepare(
      'INSERT INTO email_verifications (user_id, token, expires_at) VALUES (?, ?, ?)'
    ).run(user.id, verificationToken, expiresAt.toISOString());
    const verificationUrl = `${FRONTEND_URL}/verify-email?token=${verificationToken}`;
    await sendVerificationEmail({
      email: user.email,
      verificationUrl,
      expiresInHours: VERIFICATION_EXPIRY_HOURS,
    });

    // Generate JWT token
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      res.status(500).json({ error: 'Server configuration error' });
      return;
    }

    const jwtToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role, email_verified: user.email_verified ?? false },
      jwtSecret,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      success: true,
      token: jwtToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        email_verified: user.email_verified ?? false,
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password }: LoginRequest = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    // Find user (case-insensitive email check)
    const emailLower = email.toLowerCase();
    const user = db
      .prepare('SELECT * FROM users WHERE email = ?')
      .get(emailLower) as (User & { password_hash: string }) | undefined;

    if (!user) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    // Check if user has a password (not Google-only account)
    if (!user.password_hash) {
      res.status(401).json({
        error: 'This account was created with Google. Please use Google login.',
      });
      return;
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    // Generate JWT token
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      res.status(500).json({ error: 'Server configuration error' });
      return;
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, email_verified: (user as User).email_verified ?? true },
      jwtSecret,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        email_verified: (user as User).email_verified ?? true,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get invitation details by token (public endpoint for registration page)
router.get('/invitation/:token', (req: Request, res: Response) => {
  try {
    const { token } = req.params;

    if (!token) {
      res.status(400).json({ error: 'Token is required' });
      return;
    }

    const invitation = db
      .prepare(
        'SELECT * FROM admin_invitations WHERE token = ? AND used = 0 AND expires_at > datetime("now")'
      )
      .get(token) as any;

    if (!invitation) {
      res.status(404).json({ error: 'Invalid or expired invitation token' });
      return;
    }

    res.json({
      success: true,
      invitation: {
        email: invitation.email,
        expires_at: invitation.expires_at,
      },
    });
  } catch (error) {
    console.error('Get invitation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get current user
router.get('/me', authenticateToken, (req: Request, res: Response) => {
  try {
    const authUser = (req as AuthRequest).user;
    if (!authUser) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const user = db
      .prepare('SELECT id, email, name, role, google_id, created_at, email_verified, email_verified_at FROM users WHERE id = ?')
      .get(authUser.id) as User;

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        email_verified: user.email_verified ?? true,
      },
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Logout (client-side token removal, but we can track it here if needed)
router.post('/logout', authenticateToken, (_req: Request, res: Response) => {
  res.json({ success: true, message: 'Logged out successfully' });
});

// Verify email with token (from link in email)
router.post('/verify-email', async (req: Request, res: Response) => {
  try {
    const { token } = req.body;
    if (!token || typeof token !== 'string') {
      res.status(400).json({ error: 'Verification token is required' });
      return;
    }

    const verification = db
      .prepare(
        'SELECT * FROM email_verifications WHERE token = ? AND expires_at > datetime("now")'
      )
      .get(token) as { id: number; user_id: number; token: string; expires_at: string } | undefined;

    if (!verification) {
      res.status(400).json({
        error: 'Invalid or expired verification link. Please request a new one.',
      });
      return;
    }

    const now = new Date().toISOString();
    db.prepare(
      'UPDATE users SET email_verified = ?, email_verified_at = ?, updated_at = ? WHERE id = ?'
    ).run(1, now, now, verification.user_id);
    db.prepare('DELETE FROM email_verifications WHERE token = ?').run(token);

    const user = db
      .prepare('SELECT id, email, name, role, email_verified FROM users WHERE id = ?')
      .get(verification.user_id) as User;

    if (!user) {
      res.status(500).json({ error: 'Failed to load user after verification' });
      return;
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      res.status(500).json({ error: 'Server configuration error' });
      return;
    }
    const jwtToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role, email_verified: true },
      jwtSecret,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      message: 'Email verified successfully',
      token: jwtToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        email_verified: true,
      },
    });
  } catch (error) {
    console.error('Verify email error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Resend verification email (authenticated)
router.post('/resend-verification', authenticateToken, async (req: Request, res: Response) => {
  try {
    const authUser = (req as AuthRequest).user;
    if (!authUser) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const user = db
      .prepare('SELECT id, email, email_verified FROM users WHERE id = ?')
      .get(authUser.id) as User & { email_verified?: boolean };

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (user.email_verified) {
      res.status(400).json({ error: 'Email is already verified' });
      return;
    }

    // Remove any existing verification tokens for this user (simple: delete by user_id)
    const existing = db
      .prepare('SELECT id, token FROM email_verifications WHERE user_id = ?')
      .all(user.id) as { id: number; token: string }[];
    for (const ev of existing) {
      db.prepare('DELETE FROM email_verifications WHERE token = ?').run(ev.token);
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + VERIFICATION_EXPIRY_HOURS);
    db.prepare(
      'INSERT INTO email_verifications (user_id, token, expires_at) VALUES (?, ?, ?)'
    ).run(user.id, verificationToken, expiresAt.toISOString());

    const verificationUrl = `${FRONTEND_URL}/verify-email?token=${verificationToken}`;
    await sendVerificationEmail({
      email: user.email,
      verificationUrl,
      expiresInHours: VERIFICATION_EXPIRY_HOURS,
    });

    res.json({
      success: true,
      message: 'Verification email sent. Please check your inbox.',
    });
  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Change password (authenticated); enforces same password policy as registration
router.post('/change-password', authenticateToken, async (req: Request, res: Response) => {
  try {
    const authUser = (req as AuthRequest).user;
    if (!authUser) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: 'Current password and new password are required' });
      return;
    }

    const passwordCheck = validatePassword(newPassword);
    if (!passwordCheck.valid) {
      res.status(400).json({ error: passwordCheck.message });
      return;
    }

    const user = db
      .prepare('SELECT id, password_hash FROM users WHERE id = ?')
      .get(authUser.id) as { id: number; password_hash: string | null } | undefined;

    if (!user || !user.password_hash) {
      res.status(400).json({
        error: 'Cannot change password for this account (e.g. Google sign-in only)',
      });
      return;
    }

    const isValid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isValid) {
      res.status(401).json({ error: 'Current password is incorrect' });
      return;
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
      newHash,
      new Date().toISOString(),
      user.id
    );

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

