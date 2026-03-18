import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from './auth.js';

/**
 * Middleware: user must be staff or admin (access to turtle records, release, sheets, review).
 * Use for all "admin" features except user management.
 */
export const requireStaff = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const user = (req as AuthRequest).user;
  if (!user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  if (user.role !== 'staff' && user.role !== 'admin') {
    res.status(403).json({ error: 'Staff or admin access required' });
    return;
  }
  next();
};

/**
 * Middleware: user must be admin (can manage users: promote, demote, list users).
 * Use only for user management routes.
 */
export const requireAdmin = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const user = (req as AuthRequest).user;
  if (!user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  if (user.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
};

