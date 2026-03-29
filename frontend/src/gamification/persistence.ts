import {
  GAME_STORAGE_PREFIX,
  GAME_STORAGE_VERSION,
  type CommunityGamePersistedState,
} from './definitions';

export function storageKeyForUser(userId: number | null): string {
  if (userId == null) return `${GAME_STORAGE_PREFIX}_guest`;
  return `${GAME_STORAGE_PREFIX}_uid_${userId}`;
}

export function readPersistedGame(key: string): CommunityGamePersistedState | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { v?: number; state?: CommunityGamePersistedState };
    if (parsed?.v !== GAME_STORAGE_VERSION || !parsed.state) return null;
    return parsed.state;
  } catch {
    return null;
  }
}

export function writePersistedGame(key: string, state: CommunityGamePersistedState): void {
  try {
    localStorage.setItem(key, JSON.stringify({ v: GAME_STORAGE_VERSION, state }));
  } catch {
    /* quota / private mode */
  }
}
