/**
 * Augment Express Request so req.user matches our auth shape.
 * This makes authenticateToken and route handlers using AuthRequest
 * compatible with Express's RequestHandler types.
 */
declare global {
  namespace Express {
    interface User {
      id: number;
      email: string;
      role: 'community' | 'staff' | 'admin';
      email_verified?: boolean;
    }
    interface Request {
      user?: User;
      /** Set by requireTeamLead: the calling lead's group id (JWT carries no group data). */
      leadGroupId?: number;
    }
  }
}

export {};
