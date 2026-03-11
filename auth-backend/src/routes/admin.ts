import express, { Request, Response } from 'express';
import crypto from 'crypto';
import db from '../db/database.js';
import { authenticateToken, AuthRequest, requireEmailVerified } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';
import { sendAdminPromotionEmail } from '../services/email.js';
import type { User, UserRole } from '../types/user.js';

const router = express.Router();

const VALID_ROLES: UserRole[] = ['community', 'staff', 'admin'];

// Promote user to admin (admin only); requires verified email
router.post(
  '/promote-to-admin',
  authenticateToken,
  requireEmailVerified,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const { email } = req.body;

      if (!email) {
        res.status(400).json({ error: 'Email is required' });
        return;
      }

      // Find user by email
      const user = db
        .prepare('SELECT id, email, role FROM users WHERE email = ?')
        .get(email) as User | undefined;

      if (user) {
        // User exists
        if (user.role === 'admin') {
          res.status(400).json({ error: 'User is already an admin' });
          return;
        }

        // Update user role to admin
        db.prepare('UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
          'admin',
          user.id
        );

        // Send email notification
        await sendAdminPromotionEmail({
          email,
          hasAccount: true,
        });

        res.json({
          success: true,
          message: `User ${email} has been promoted to admin`,
          user: {
            id: user.id,
            email: user.email,
            role: 'admin',
          },
        });
      } else {
        // User doesn't exist - create invitation
        // Check if there's already an unused invitation for this email
        const existingInvitation = db
          .prepare(
            'SELECT * FROM admin_invitations WHERE email = ? AND used = 0 AND expires_at > datetime("now")'
          )
          .get(email) as any;

        if (existingInvitation) {
          res.status(400).json({
            error: 'An active invitation already exists for this email address',
          });
          return;
        }

        // Generate invitation token
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7); // 7 days from now

        // Create invitation
        db.prepare(
          'INSERT INTO admin_invitations (email, token, expires_at) VALUES (?, ?, ?)'
        ).run(email, token, expiresAt.toISOString());

        // Send invitation email
        await sendAdminPromotionEmail({
          email,
          hasAccount: false,
          invitationToken: token,
        });

        res.json({
          success: true,
          message: `Admin invitation has been sent to ${email}`,
          invitation: {
            email,
            expiresAt: expiresAt.toISOString(),
          },
        });
      }
    } catch (error) {
      console.error('Promote to admin error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// Get all users (admin only) - for admin dashboard; requires verified email
router.get(
  '/users',
  authenticateToken,
  requireEmailVerified,
  requireAdmin,
  (_req: Request, res: Response) => {
    try {
      const users = db
        .prepare(
          'SELECT id, email, name, role, created_at FROM users ORDER BY created_at DESC'
        )
        .all() as (Omit<User, 'google_id'>)[];

      res.json({
        success: true,
        users,
      });
    } catch (error) {
      console.error('Get users error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// Set user role (admin only); for promote to staff/admin or demote
router.patch(
  '/users/:id/role',
  authenticateToken,
  requireEmailVerified,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const userId = Number(req.params.id);
      const { role } = req.body as { role?: string };

      if (!Number.isInteger(userId) || userId < 1) {
        res.status(400).json({ error: 'Invalid user ID' });
        return;
      }
      if (!role || !VALID_ROLES.includes(role as UserRole)) {
        res.status(400).json({
          error: `Role must be one of: ${VALID_ROLES.join(', ')}`,
        });
        return;
      }

      const user = db.prepare('SELECT id, email, role FROM users WHERE id = ?').get(userId) as User | undefined;
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const newRole = role as UserRole;
      const oldRole = user.role;

      // Prevent demoting the last admin so admin routes remain reachable
      if (oldRole === 'admin' && newRole !== 'admin') {
        const adminCount = (db.prepare('SELECT COUNT(*) as count FROM users WHERE role = ?').get('admin') as { count: number }).count;
        if (adminCount <= 1) {
          res.status(400).json({
            error: 'Cannot demote the last admin. Promote another user to admin first.',
          });
          return;
        }
      }

      db.prepare('UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newRole, userId);

      // Invalidate existing JWTs when demoting so elevated privileges are revoked immediately
      const roleRank = (r: UserRole) => (r === 'admin' ? 3 : r === 'staff' ? 2 : 1);
      if (roleRank(newRole) < roleRank(oldRole)) {
        db.prepare(
          'UPDATE users SET tokens_valid_after = CURRENT_TIMESTAMP WHERE id = ?'
        ).run(userId);
      }

      res.json({
        success: true,
        message: `User role set to ${newRole}`,
        user: {
          id: user.id,
          email: user.email,
          role: newRole,
        },
      });
    } catch (error) {
      console.error('Set role error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

export default router;

