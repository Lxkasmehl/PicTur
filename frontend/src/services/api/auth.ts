/**
 * Auth API – login, register, user, invitations, admin
 */

import {
  AUTH_API_BASE_URL,
  getToken,
  setToken,
  removeToken,
} from './config';
import type { GroupRole, GroupScope, UserGroup } from '../../types/User';

/** community (default) | staff (admin-like, no user management) | admin (full) */
export type UserRole = 'community' | 'staff' | 'admin';

export interface User {
  id: number;
  email: string;
  name: string | null;
  role: UserRole;
  email_verified?: boolean;
  /** Resolved group membership (null/absent = unassigned). Present on /auth/me + /auth/validate. */
  group?: UserGroup | null;
  /** Membership rank within the group; 'lead' marks a Team Lead (staff only). */
  group_role?: GroupRole;
  /** Assigned area path prefixes (empty for global-scope groups and unassigned users). */
  areas?: string[];
}

/** Anything carrying the membership fields — accepts both the API `User` and the store `UserInfo`. */
type MembershipLike =
  | { role?: UserRole; group?: UserGroup | null; group_role?: GroupRole }
  | null
  | undefined;

/** True if user can access turtle records, release, sheets, review (staff or admin). */
export function isStaffRole(role: string | undefined): role is UserRole {
  return role === 'staff' || role === 'admin';
}

/** True only for full admin (user management, offline backup download). */
export function isAdminRole(role: string | undefined): boolean {
  return role === 'admin';
}

/** True for a staff user acting as a Team Lead (staff + group_role 'lead'). */
export function isTeamLead(u: MembershipLike): boolean {
  return u?.role === 'staff' && u?.group_role === 'lead';
}

/**
 * True when the user has full, unscoped access. Mirrors the backend rule
 * (`is_global = role=='admin' OR group.scope=='global'`, backend/auth.py): an admin
 * is ALWAYS global regardless of group, plus anyone with no group or a global-scope
 * group (Operations / Primary). Only a non-admin in a scoped Sub-Area group is false.
 */
export function isGlobalScope(u: MembershipLike): boolean {
  return u?.role === 'admin' || !u?.group || u.group.scope === 'global';
}

/**
 * True for a member who is actually confined to a scoped (Sub-Area) group — i.e. NOT
 * global. Admins are never scoped (they are global server-side even inside a scoped
 * group), so this is effectively a non-admin staff user in a scoped group.
 */
export function isScopedUser(u: MembershipLike): boolean {
  return !isGlobalScope(u) && !!u?.group && u.group.scope === 'scoped';
}

export interface AuthResponse {
  success: boolean;
  token: string;
  user: User;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name?: string;
  token?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

// Make authenticated API request to Auth Backend
export const apiRequest = async (
  endpoint: string,
  options: RequestInit = {},
): Promise<Response> => {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${AUTH_API_BASE_URL}${endpoint}`, {
    ...options,
    headers: headers as HeadersInit,
  });

  return response;
};

// Register new user
export const register = async (data: RegisterRequest): Promise<AuthResponse> => {
  const response = await apiRequest('/auth/register', {
    method: 'POST',
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Registration failed');
  }

  const result = await response.json();
  if (result.success && result.token) {
    setToken(result.token);
  }
  return result;
};

// Login
export const login = async (data: LoginRequest): Promise<AuthResponse> => {
  const response = await apiRequest('/auth/login', {
    method: 'POST',
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Login failed');
  }

  const result = await response.json();
  if (result.success && result.token) {
    setToken(result.token);
  }
  return result;
};

// Get current user
export const getCurrentUser = async (): Promise<User | null> => {
  const token = getToken();
  if (!token) {
    return null;
  }

  const response = await apiRequest('/auth/me');

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      removeToken();
      return null;
    }
    const error = await response.json();
    throw new Error(error.error || 'Failed to get user');
  }

  const result = await response.json();
  const u = result.user as User;
  if (!u) return null;
  return {
    ...u,
    email_verified:
      u.email_verified === undefined || u.email_verified === null
        ? undefined
        : Boolean(u.email_verified),
  };
};

// Logout
export const logout = async (): Promise<void> => {
  try {
    await apiRequest('/auth/logout', {
      method: 'POST',
    });
  } catch (error) {
    console.error('Logout error:', error);
  } finally {
    removeToken();
  }
};

// Google OAuth URL
export const getGoogleAuthUrl = (): string => {
  return `${AUTH_API_BASE_URL.replace('/api', '')}/api/auth/google`;
};

// Get invitation details by token
export interface InvitationDetails {
  success: boolean;
  invitation: {
    email: string;
    expires_at: string;
  };
}

export const getInvitationDetails = async (
  token: string,
): Promise<InvitationDetails> => {
  const response = await apiRequest(`/auth/invitation/${token}`, {
    method: 'GET',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to get invitation details');
  }

  return await response.json();
};

// Verify email with token (from link in email)
export const verifyEmail = async (
  token: string,
  signal?: AbortSignal,
): Promise<AuthResponse> => {
  const response = await apiRequest('/auth/verify-email', {
    method: 'POST',
    body: JSON.stringify({ token }),
    signal,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Verification failed');
  }

  const result = await response.json();
  if (result.success && result.token) {
    setToken(result.token);
  }
  return result;
};

// Resend verification email (authenticated)
export const resendVerificationEmail = async (): Promise<{
  success: boolean;
  message: string;
}> => {
  const response = await apiRequest('/auth/resend-verification', {
    method: 'POST',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to resend verification email');
  }

  return await response.json();
};

// Promote user to admin (admin only)
export interface PromoteToAdminResponse {
  success: boolean;
  message: string;
  user: {
    id: number;
    email: string;
    role: 'admin';
  };
}

export const promoteToAdmin = async (
  email: string,
): Promise<PromoteToAdminResponse> => {
  const response = await apiRequest('/admin/promote-to-admin', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to promote user to admin');
  }

  return await response.json();
};

// Get all users (admin only)
export interface AdminUserRow {
  id: number;
  email: string;
  name: string | null;
  role: UserRole;
  created_at: string;
  /** Group membership (null = Unassigned). */
  group_id: number | null;
  group_role: GroupRole;
  group_name: string | null;
}

export interface GetUsersResponse {
  success: boolean;
  users: AdminUserRow[];
}

export const getUsers = async (): Promise<GetUsersResponse> => {
  const response = await apiRequest('/admin/users', { method: 'GET' });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to load users');
  }
  return await response.json();
};

// Set user role (admin only); for promote to staff or demote
export type SetRoleBody = { role: UserRole };

export const setUserRole = async (
  userId: number,
  role: UserRole,
): Promise<{ success: boolean; message: string; user: { id: number; email: string; role: UserRole } }> => {
  const response = await apiRequest(`/admin/users/${userId}/role`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to set user role');
  }

  return await response.json();
};

export const deleteUser = async (
  userId: number,
): Promise<{ success: boolean; message: string }> => {
  const response = await apiRequest(`/admin/users/${userId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to delete user');
  }

  return await response.json();
};

// ---------------------------------------------------------------------------
// Groups (admin only) — /api/admin/groups
// ---------------------------------------------------------------------------

/** A group row from the list endpoint (includes derived areas + member count). */
export interface Group {
  id: number;
  name: string;
  scope: GroupScope;
  /** Non-null for the seeded system groups ('operations' / 'primary'); null for Sub-Areas. */
  system_key: string | null;
  areas: string[];
  member_count: number;
  created_at: string;
}

/** Base group returned by create/update (no derived areas/member_count). */
export interface GroupBase {
  id: number;
  name: string;
  scope: GroupScope;
  system_key: string | null;
}

/** An error carrying the HTTP status, so callers can branch on 403/409 etc. */
export class ApiError extends Error {
  status: number;
  /** Present on a 409 delete-group conflict. */
  memberCount?: number;
  constructor(message: string, status: number, memberCount?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.memberCount = memberCount;
  }
}

export const getGroups = async (): Promise<{ success: boolean; groups: Group[] }> => {
  const response = await apiRequest('/admin/groups', { method: 'GET' });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to load groups');
  }
  return await response.json();
};

export const createGroup = async (
  name: string,
  scope: GroupScope = 'scoped',
): Promise<{ success: boolean; group: GroupBase }> => {
  const response = await apiRequest('/admin/groups', {
    method: 'POST',
    body: JSON.stringify({ name, scope }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to create group');
  }
  return await response.json();
};

export const updateGroup = async (
  id: number,
  changes: { name?: string; scope?: GroupScope },
): Promise<{ success: boolean; group: GroupBase }> => {
  const response = await apiRequest(`/admin/groups/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(changes),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to update group');
  }
  return await response.json();
};

/** Delete a group. A 409 (non-empty group) surfaces the member count so the UI can prompt a reassign. */
export const deleteGroup = async (
  id: number,
): Promise<{ success: boolean; message: string }> => {
  const response = await apiRequest(`/admin/groups/${id}`, { method: 'DELETE' });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    if (response.status === 409 && typeof error.member_count === 'number') {
      const n = error.member_count as number;
      throw new ApiError(`${n} member${n === 1 ? '' : 's'} — reassign first`, 409, n);
    }
    throw new ApiError(error.error || 'Failed to delete group', response.status);
  }
  return await response.json();
};

export const setGroupAreas = async (
  id: number,
  areas: string[],
): Promise<{ success: boolean; areas: string[] }> => {
  const response = await apiRequest(`/admin/groups/${id}/areas`, {
    method: 'PUT',
    body: JSON.stringify({ areas }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to save areas');
  }
  return await response.json();
};

// ---------------------------------------------------------------------------
// Membership (admin only) — one-step stray-user correction
// ---------------------------------------------------------------------------

export interface SetMembershipBody {
  group_id: number | null;
  group_role?: GroupRole;
}

export const setUserMembership = async (
  userId: number,
  body: SetMembershipBody,
): Promise<{
  success: boolean;
  user: { id: number; email: string; role: UserRole; group_id: number | null; group_role: GroupRole };
}> => {
  const response = await apiRequest(`/admin/users/${userId}/membership`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to update membership');
  }
  return await response.json();
};

// ---------------------------------------------------------------------------
// Team Lead (staff leads only) — /api/lead
// ---------------------------------------------------------------------------

export interface GroupMember {
  id: number;
  email: string;
  name: string | null;
  role: UserRole;
  group_role: GroupRole;
  created_at: string;
}

export interface MyGroupResponse {
  success: boolean;
  group: { id: number; name: string; scope: GroupScope; system_key: string | null };
  areas: string[];
  members: GroupMember[];
}

/** The lead's own group. Throws an {@link ApiError} with status 403 when the caller is not a lead. */
export const getMyGroup = async (): Promise<MyGroupResponse> => {
  const response = await apiRequest('/lead/group', { method: 'GET' });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new ApiError(error.error || 'Failed to load your group', response.status);
  }
  return await response.json();
};

export const claimMember = async (
  email: string,
): Promise<{
  success: boolean;
  user: { id: number; email: string; role: UserRole; group_id: number; group_role: GroupRole };
}> => {
  const response = await apiRequest('/lead/members/claim', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to claim member');
  }
  return await response.json();
};

export type MemberRankAction = 'promote' | 'demote';

export const setMemberRank = async (
  userId: number,
  action: MemberRankAction,
): Promise<{
  success: boolean;
  user: { id: number; email: string; role: UserRole; group_role: GroupRole };
}> => {
  const response = await apiRequest(`/lead/members/${userId}/rank`, {
    method: 'PATCH',
    body: JSON.stringify({ action }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to change rank');
  }
  return await response.json();
};

export const releaseMember = async (
  userId: number,
): Promise<{ success: boolean; message: string }> => {
  const response = await apiRequest(`/lead/members/${userId}`, { method: 'DELETE' });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to release member');
  }
  return await response.json();
};
