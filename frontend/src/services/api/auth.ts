/**
 * Auth API – login, register, user, invitations, admin
 */

import {
  AUTH_API_BASE_URL,
  getToken,
  setToken,
  removeToken,
} from './config';

/** community (default) | staff (admin-like, no user management) | admin (full) */
export type UserRole = 'community' | 'staff' | 'admin';

export interface User {
  id: number;
  email: string;
  name: string | null;
  role: UserRole;
  email_verified?: boolean;
}

/** True if user can access turtle records, release, sheets, review (staff or admin). */
export function isStaffRole(role: string | undefined): role is UserRole {
  return role === 'staff' || role === 'admin';
}

/** True only for full admin (user management, offline backup download). */
export function isAdminRole(role: string | undefined): boolean {
  return role === 'admin';
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
export interface GetUsersResponse {
  success: boolean;
  users: Array<{ id: number; email: string; name: string | null; role: UserRole; created_at: string }>;
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
