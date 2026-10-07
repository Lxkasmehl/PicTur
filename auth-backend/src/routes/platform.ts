/**
 * Platform level: super admins see and manage who else is a super admin.
 *
 * Super admin status is read live from the database on every request (never from the JWT), so
 * granting or revoking it takes effect immediately.
 */
import express, { Request, Response } from 'express';
import db from '../db/database.js';
import { listSuperAdmins, setSuperAdmin } from '../db/orgsRepo.js';
import { authenticateToken, AuthRequest, requireEmailVerified } from '../middleware/auth.js';
import { requireSuperAdmin } from '../middleware/admin.js';

const router = express.Router();

router.get('/super-admins', authenticateToken, requireSuperAdmin, (_req: Request, res: Response) => {
  res.json({ success: true, super_admins: listSuperAdmins() });
});

// Promote an existing account (by email).
router.post(
  '/super-admins',
  authenticateToken,
  requireEmailVerified,
  requireSuperAdmin,
  (req: Request, res: Response) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!email) {
      res.status(400).json({ error: 'Email is required' });
      return;
    }
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as
      | { id: number }
      | undefined;
    if (!user) {
      res.status(404).json({
        error: 'No account with this email. The person has to register first, then you can promote them.',
      });
      return;
    }
    setSuperAdmin(user.id, true);
    res.json({ success: true, super_admins: listSuperAdmins() });
  }
);

// Revoke super admin rights (the account itself and its group roles stay).
router.delete(
  '/super-admins/:userId',
  authenticateToken,
  requireEmailVerified,
  requireSuperAdmin,
  (req: Request, res: Response) => {
    const userId = Number(req.params.userId);
    const current = listSuperAdmins();
    const target = current.find((s) => s.id === userId);
    if (!target) {
      res.status(404).json({ error: 'This account is not a super admin' });
      return;
    }
    if (target.from_env) {
      res.status(409).json({
        error:
          'This super admin is set in the server configuration (SUPER_ADMIN_EMAILS) and would be ' +
          'restored on the next restart. Remove the address there.',
      });
      return;
    }
    if (current.length <= 1) {
      res.status(409).json({ error: 'The last super admin cannot be removed' });
      return;
    }
    setSuperAdmin(userId, false);
    const self = (req as AuthRequest).user!.id === userId;
    res.json({ success: true, self, super_admins: listSuperAdmins() });
  }
);

export default router;
