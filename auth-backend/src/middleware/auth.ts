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

export type BearerUserResult =
  | { kind: 'missing' }
  | { kind: 'invalid'; message: string }
  | { kind: 'ok'; user: { id: number; email: string; role: 'community' | 'staff' | 'admin' } };

/**
 * Validates Authorization Bearer when present. Used by required and optional auth middleware.
 */
export function resolveBearerUser(req: Request): BearerUserResult {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return { kind: 'missing' };
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    return { kind: 'invalid', message: 'Server configuration error' };
  }

  try {
    const decoded = jwt.verify(token, jwtSecret) as {
      id: number;
      email: string;
      role: 'community' | 'staff' | 'admin';
      iat?: number;
    };
    const row = db
      .prepare('SELECT tokens_valid_after FROM users WHERE id = ?')
      .get(decoded.id) as { tokens_valid_after: string | null } | undefined;
    if (!row) {
      return { kind: 'invalid', message: 'Token has been revoked' };
    }
    const validAfter = row.tokens_valid_after;
    if (validAfter && decoded.iat != null) {
      const validAfterSeconds = Math.floor(new Date(validAfter).getTime() / 1000);
      if (decoded.iat <= validAfterSeconds) {
        return { kind: 'invalid', message: 'Token has been revoked' };
      }
    }
    return { kind: 'ok', user: decoded };
  } catch {
    return { kind: 'invalid', message: 'Invalid or expired token' };
  }
}

export const authenticateToken = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const resolved = resolveBearerUser(req);
  if (resolved.kind === 'missing') {
    res.status(401).json({ error: 'Access token required' });
    return;
  }
  if (resolved.kind === 'invalid') {
    const status = resolved.message === 'Server configuration error' ? 500 : 403;
    res.status(status).json({ error: resolved.message });
    return;
  }
  (req as AuthRequest).user = resolved.user;
  next();
};

/**
 * If a Bearer token is present and valid, sets req.user; missing token continues without user.
 * Invalid/expired/revoked tokens are ignored so the request proceeds anonymously (clients often
 * send stale Authorization headers on public endpoints).
 */
export const optionalAuthenticateToken = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const resolved = resolveBearerUser(req);
  if (resolved.kind === 'missing') {
    next();
    return;
  }
  if (resolved.kind === 'invalid') {
    if (resolved.message === 'Server configuration error') {
      res.status(500).json({ error: resolved.message });
      return;
    }
    next();
    return;
  }
  (req as AuthRequest).user = resolved.user;
  next();
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

