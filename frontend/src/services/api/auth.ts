/**
 * Auth API – login, register, user, invitations, admin
 */

import {
  AUTH_API_BASE_URL,
  getToken,
  setToken,
  removeToken,
} from './config';

export interface User {
  id: number;
  email: string;
  name: string | null;
  role: 'community' | 'admin';
  email_verified?: boolean;
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
  return result.user;
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
export const verifyEmail = async (token: string): Promise<AuthResponse> => {
  const response = await apiRequest('/auth/verify-email', {
    method: 'POST',
    body: JSON.stringify({ token }),
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
