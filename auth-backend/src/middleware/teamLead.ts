import { Request, Response, NextFunction } from 'express';
import db from '../db/database.js';
import { AuthRequest } from './auth.js';
import type { GroupRole } from '../types/group.js';

/**
 * Middleware: the caller must be a Team Lead — a staff user whose membership is group_role='lead'
 * with a non-null group. Must run after authenticateToken + requireEmailVerified. The JWT carries no
 * group data, so the caller's row is loaded fresh from the DB; the lead's group id is attached to
 * the request as req.leadGroupId for the route handlers.
 */
export const requireTeamLead = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const authUser = (req as AuthRequest).user;
  if (!authUser) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const row = db
    .prepare('SELECT role, group_id, group_role FROM users WHERE id = ?')
    .get(authUser.id) as
    | { role: string; group_id: number | null; group_role: GroupRole }
    | undefined;

  if (!row) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  if (row.role !== 'staff' || row.group_role !== 'lead' || row.group_id === null) {
    res.status(403).json({ error: 'Team lead access required' });
    return;
  }

  (req as AuthRequest).leadGroupId = row.group_id;
  next();
};
