/**
 * UI preferences stored per user in auth-backend (`user_ui_preferences`), synced across devices.
 */

import { apiRequest } from './auth';

export interface UserUiPreferences {
  homeMatchScopeFavorites: string[];
}

export interface UserUiPreferencesGetResponse {
  success: boolean;
  preferences: UserUiPreferences;
  error?: string;
}

export async function fetchUserUiPreferences(): Promise<UserUiPreferences | null> {
  const res = await apiRequest('/auth/user-ui-preferences', { method: 'GET' });
  if (res.status === 401 || res.status === 403) {
    return null;
  }
  if (!res.ok) {
    throw new Error('Failed to load user preferences');
  }
  const data = (await res.json()) as UserUiPreferencesGetResponse;
  if (!data.success || !data.preferences) {
    return null;
  }
  return data.preferences;
}

export async function saveUserUiPreferences(preferences: UserUiPreferences): Promise<void> {
  const res = await apiRequest('/auth/user-ui-preferences', {
    method: 'PUT',
    body: JSON.stringify(preferences),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || 'Failed to save user preferences');
  }
}
