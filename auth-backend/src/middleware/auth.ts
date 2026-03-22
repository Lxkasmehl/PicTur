import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import db from '../db/database.js';

export interface AuthRequest extends Request {
  user?: {
    id: number;
    email: string;
    role: 'community' | 'staff' | 'admin';
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
      role: 'community' | 'staff' | 'admin';
      iat?: number;
    };
    // Require an existing user so deleted accounts cannot keep using signed JWTs until expiry.
    // Also invalidate tokens issued at or before tokens_valid_after (e.g. after role demotion).
    // Use <= so same-second tokens are revoked (iat and validAfter are second-granular).
    const row = db
      .prepare('SELECT tokens_valid_after FROM users WHERE id = ?')
      .get(decoded.id) as { tokens_valid_after: string | null } | undefined;
    if (!row) {
      res.status(403).json({ error: 'Token has been revoked' });
      return;
    }
    const validAfter = row.tokens_valid_after;
    if (validAfter && decoded.iat != null) {
      const validAfterSeconds = Math.floor(new Date(validAfter).getTime() / 1000);
      if (decoded.iat <= validAfterSeconds) {
        res.status(403).json({ error: 'Token has been revoked' });
        return;
      }
    }
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

