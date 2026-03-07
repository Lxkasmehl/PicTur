import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from './auth.js';

/**
 * Middleware to check if the authenticated user is an admin
 * Must be used after authenticateToken middleware
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

