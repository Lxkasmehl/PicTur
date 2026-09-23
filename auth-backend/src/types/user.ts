import type { GroupRole } from './group.js';

/** User roles: community (default), staff (admin-like, no user management), admin (full, can manage users) */
export type UserRole = 'community' | 'staff' | 'admin';

export interface User {
  id: number;
  email: string;
  name: string | null;
  role: UserRole;
  google_id: string | null;
  created_at: string;
  email_verified: boolean;
  email_verified_at: string | null;
  /** Group membership (nullable = unassigned). Enforced by the repo layer, no DB FK. */
  group_id?: number | null;
  /** Membership rank within the group; 'lead' marks a Team Lead (staff only). */
  group_role?: GroupRole;
}

export interface UserWithoutPassword extends Omit<User, 'password_hash'> {}

export interface RegisterRequest {
  email: string;
  password: string;
  name?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

