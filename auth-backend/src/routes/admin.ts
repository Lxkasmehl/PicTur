import express, { Request, Response } from 'express';
import crypto from 'crypto';
import db from '../db/database.js';
import { getGroup } from '../db/groupsRepo.js';
import { authenticateToken, AuthRequest, requireEmailVerified } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';
import { sendAdminPromotionEmail } from '../services/email.js';
import type { User, UserRole } from '../types/user.js';
import type { GroupRole } from '../types/group.js';

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
            'SELECT * FROM admin_invitations WHERE email = ? AND used = 0 AND julianday(expires_at) > julianday(\'now\')'
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
          `SELECT u.id, u.email, u.name, u.role, u.created_at, u.group_id, u.group_role, g.name AS group_name
             FROM users u
             LEFT JOIN groups g ON g.id = u.group_id
            ORDER BY u.created_at DESC`
        )
        .all() as Array<
          Pick<User, 'id' | 'email' | 'name' | 'role' | 'created_at' | 'group_id' | 'group_role'> & {
            group_name: string | null;
          }
        >;

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

      // Prevent demoting the last admin so admin routes remain reachable.
      if (oldRole === 'admin' && newRole !== 'admin') {
        const admins = db.prepare('SELECT id FROM users WHERE role = ?').all('admin') as { id: number }[];
        const adminCount = admins.length;
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

// Set a user's group membership (admin only). One-step stray-user correction: lateral moves and
// promotions do NOT log the user out. Revocation is bumped ONLY when privileges are reduced.
router.patch(
  '/users/:id/membership',
  authenticateToken,
  requireEmailVerified,
  requireAdmin,
  (req: Request, res: Response) => {
    try {
      const userId = Number(req.params.id);
      if (!Number.isInteger(userId) || userId < 1) {
        res.status(400).json({ error: 'Invalid user ID' });
        return;
      }

      const body = req.body as { group_id?: unknown; group_role?: unknown };

      // group_id is required and must be an integer group id or null.
      if (!('group_id' in body) || (body.group_id !== null && !Number.isInteger(body.group_id))) {
        res.status(400).json({ error: 'group_id must be a group id or null' });
        return;
      }
      const newGroupId = body.group_id === null ? null : Number(body.group_id);

      let requestedRole: GroupRole | undefined;
      if (body.group_role !== undefined) {
        if (body.group_role !== 'member' && body.group_role !== 'lead') {
          res.status(400).json({ error: "group_role must be 'member' or 'lead'" });
          return;
        }
        requestedRole = body.group_role;
      }

      const user = db
        .prepare('SELECT id, email, role, group_id, group_role FROM users WHERE id = ?')
        .get(userId) as
        | { id: number; email: string; role: UserRole; group_id: number | null; group_role: GroupRole }
        | undefined;
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      if (newGroupId !== null && !getGroup(newGroupId)) {
        res.status(400).json({ error: 'Unknown group_id' });
        return;
      }

      const prevGroupId = user.group_id;
      const prevGroupRole: GroupRole = user.group_role === 'lead' ? 'lead' : 'member';

      // Unassigning forces 'member'; otherwise honor an explicit request, else keep the current rank.
      let newGroupRole: GroupRole;
      if (newGroupId === null) {
        newGroupRole = 'member';
      } else if (requestedRole !== undefined) {
        newGroupRole = requestedRole;
      } else {
        newGroupRole = prevGroupRole;
      }

      // Leads must be staff. Admins may hold 'lead' harmlessly; community users cannot.
      if (newGroupRole === 'lead' && user.role === 'community') {
        res.status(400).json({ error: 'Only staff or admin users can be group leads' });
        return;
      }

      db.prepare(
        'UPDATE users SET group_id = ?, group_role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).run(newGroupId, newGroupRole, userId);

      // Revoke existing JWTs only when privileges are reduced: dropping the lead rank, or releasing a
      // still-privileged (staff/admin) user to Unassigned. Lateral moves and promotions must not bump.
      const demotedFromLead = prevGroupRole === 'lead' && newGroupRole !== 'lead';
      const releasedToUnassigned =
        prevGroupId !== null &&
        newGroupId === null &&
        (user.role === 'staff' || user.role === 'admin');
      if (demotedFromLead || releasedToUnassigned) {
        db.prepare('UPDATE users SET tokens_valid_after = CURRENT_TIMESTAMP WHERE id = ?').run(userId);
      }

      res.json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          group_id: newGroupId,
          group_role: newGroupRole,
        },
      });
    } catch (error) {
      console.error('Set membership error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// Delete user by id (admin only). CASCADE removes related rows (verifications, community_game).
router.delete(
  '/users/:id',
  authenticateToken,
  requireEmailVerified,
  requireAdmin,
  (req: Request, res: Response) => {
    try {
      const authUser = (req as AuthRequest).user;
      if (!authUser) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const userId = Number(req.params.id);
      if (!Number.isInteger(userId) || userId < 1) {
        res.status(400).json({ error: 'Invalid user ID' });
        return;
      }

      if (userId === authUser.id) {
        res.status(400).json({ error: 'You cannot delete your own account while logged in.' });
        return;
      }

      const user = db.prepare('SELECT id, email, role FROM users WHERE id = ?').get(userId) as
        | User
        | undefined;
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      if (user.role === 'admin') {
        const admins = db.prepare('SELECT id FROM users WHERE role = ?').all('admin') as {
          id: number;
        }[];
        if (admins.length <= 1) {
          res.status(400).json({
            error: 'Cannot delete the last admin. Promote another user to admin first.',
          });
          return;
        }
      }

      // JWTs for this user fail on the next request: authenticateToken requires a users row
      // (signature alone is not enough after deletion).
      db.prepare('DELETE FROM users WHERE id = ?').run(userId);

      res.json({
        success: true,
        message: `User ${user.email} has been deleted`,
      });
    } catch (error) {
      console.error('Delete user error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

export default router;

