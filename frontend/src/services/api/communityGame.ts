/**
 * Observer / gamification sync — auth-backend `community_game_states` (per user), not profile fields.
 */

import { apiRequest } from './auth';
import type { CommunityGamePersistedState } from '../../gamification/definitions';

export interface CommunityGameGetResponse {
  success: boolean;
  state: CommunityGamePersistedState | null;
  message?: string;
}

export async function fetchCommunityGameState(): Promise<CommunityGamePersistedState | null> {
  const res = await apiRequest('/auth/community-game', { method: 'GET' });
  if (res.status === 401 || res.status === 403) {
    return null;
  }
  if (!res.ok) {
    throw new Error('Failed to load observer progress');
  }
  const data = (await res.json()) as CommunityGameGetResponse;
  if (!data.success) {
    return null;
  }
  return data.state ?? null;
}

export async function saveCommunityGameState(state: CommunityGamePersistedState): Promise<void> {
  const res = await apiRequest('/auth/community-game', {
    method: 'PUT',
    body: JSON.stringify(state),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || 'Failed to save observer progress');
  }
}
