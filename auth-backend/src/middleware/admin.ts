import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from './auth.js';
import { getOrgById, getOrgRole, isSuperAdmin } from '../db/orgsRepo.js';
import type { UserRole } from '../types/user.js';

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

/** Middleware: platform-level super admin (creates research groups, assigns their admins). */
export const requireSuperAdmin = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const user = (req as AuthRequest).user;
  if (!user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  if (!isSuperAdmin(user.id)) {
    res.status(403).json({ error: 'Super admin access required' });
    return;
  }
  next();
};

/**
 * Middleware factory: the user must hold one of `roles` in the research group given by the
 * `:orgId` route param (super admins always pass). Sets res.locals.org.
 */
export const requireOrgRole =
  (roles: UserRole[]) =>
  (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as AuthRequest).user;
    if (!user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const orgId = Number(req.params.orgId);
    const org = Number.isInteger(orgId) ? getOrgById(orgId) : null;
    if (!org) {
      res.status(404).json({ error: 'Research group not found' });
      return;
    }
    const role = getOrgRole(user.id, org.id);
    if (!role || !roles.includes(role)) {
      res.status(403).json({ error: 'You do not have access to this research group' });
      return;
    }
    res.locals.org = org;
    next();
  };

