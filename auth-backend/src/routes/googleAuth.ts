import express, { Request, Response } from 'express';
import passport from 'passport';
import jwt from 'jsonwebtoken';
import type { User } from '../types/user.js';

const router = express.Router();

// Initiate Google OAuth
router.get('/google', (req: Request, res: Response) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    res.status(503).json({
      error:
        'Google OAuth is not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env',
    });
    return;
  }
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res);
});

// Google OAuth callback
router.get(
  '/google/callback',
  (req: Request, res: Response, next: any) => {
    console.log('📥 Google OAuth callback received');
    console.log('   Query params:', req.query);
    passport.authenticate(
      'google',
      { session: false },
      (err: any, user: any, info: any) => {
        console.log('🔍 Passport authenticate result:');
        console.log('   Error:', err);
        console.log(
          '   User:',
          user ? `Found (ID: ${user.id}, Email: ${user.email})` : 'Not found',
        );
        console.log('   Info:', info);

        if (err) {
          console.error('❌ Passport authentication error:', err);
          return res.redirect(
            `${process.env.FRONTEND_URL}/login?error=auth_failed&message=${encodeURIComponent(err.message || 'Authentication failed')}`,
          );
        }

        if (!user) {
          console.error('❌ No user returned from Passport');
          return res.redirect(
            `${process.env.FRONTEND_URL}/login?error=auth_failed&message=No user found`,
          );
        }

        // Store user in request for next middleware
        req.user = user;
        next();
      },
    )(req, res, next);
  },
  (req: Request, res: Response) => {
    try {
      const user = req.user as User & { password_hash?: string };

      if (!user) {
        console.error('❌ User not found in request');
        res.redirect(`${process.env.FRONTEND_URL}/login?error=auth_failed`);
        return;
      }

      console.log(
        `✅ Generating JWT for user: ${user.email} (ID: ${user.id}, Role: ${user.role})`,
      );

      // Generate JWT token
      const jwtSecret = process.env.JWT_SECRET;
      if (!jwtSecret) {
        res.redirect(`${process.env.FRONTEND_URL}/login?error=server_error`);
        return;
      }

      const token = jwt.sign(
        { id: user.id, email: user.email, role: user.role, email_verified: true },
        jwtSecret,
        { expiresIn: '7d' },
      );

      // Redirect to frontend with token
      // Use /login route which handles OAuth tokens, not /signup
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      res.redirect(
        `${frontendUrl}/login?token=${token}&email=${encodeURIComponent(user.email)}&name=${encodeURIComponent(user.name || '')}&role=${user.role}&oauth=true`,
      );
    } catch (error) {
      console.error('Google OAuth callback error:', error);
      res.redirect(`${process.env.FRONTEND_URL}/login?error=auth_failed`);
    }
  },
);

// OAuth error handler
router.get('/google/error', (req: Request, res: Response) => {
  const error = String(req.query.error ?? 'unknown_error');
  const rawDescription = req.query.error_description;
  const errorDescription = String(
    typeof rawDescription === 'string'
      ? rawDescription
      : 'An error occurred during Google OAuth',
  );

  console.error('❌ Google OAuth Error:');
  console.error(`   Error: ${error}`);
  console.error(`   Description: ${errorDescription}`);
  console.error(`   Query params:`, req.query);

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  res.redirect(
    `${frontendUrl}/login?error=auth_failed&message=${encodeURIComponent(errorDescription)}`,
  );
});

export default router;
