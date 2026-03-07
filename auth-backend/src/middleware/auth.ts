import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import db from '../db/database.js';

export interface AuthRequest extends Request {
  user?: {
    id: number;
    email: string;
    role: 'community' | 'admin';
  };
}

export const authenticateToken = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    res.status(401).json({ error: 'Access token required' });
    return;
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    res.status(500).json({ error: 'Server configuration error' });
    return;
  }

  try {
    const decoded = jwt.verify(token, jwtSecret) as {
      id: number;
      email: string;
      role: 'community' | 'admin';
    };
    (req as AuthRequest).user = decoded;
    next();
  } catch (error) {
    res.status(403).json({ error: 'Invalid or expired token' });
  }
};

/**
 * Require that the authenticated user has verified their email.
 * Must be used after authenticateToken. Returns 403 if email is not verified.
 */
export const requireEmailVerified = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const authUser = (req as AuthRequest).user;
  if (!authUser) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const user = db
    .prepare('SELECT email_verified FROM users WHERE id = ?')
    .get(authUser.id) as { email_verified: boolean } | undefined;

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  if (!user.email_verified) {
    res.status(403).json({
      error: 'Please verify your email address to access this feature.',
      code: 'EMAIL_NOT_VERIFIED',
    });
    return;
  }

  next();
};

