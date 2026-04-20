/** Local cache / fallback when not logged in or auth API unavailable. Server copy lives in auth-backend `user_ui_preferences`. */
const STORAGE_KEY = 'homeMatchScopeFavoriteLocations';

export function loadHomeMatchScopeFavorites(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

export function saveHomeMatchScopeFavorites(ordered: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ordered));
  } catch {
    /* ignore quota / private mode */
  }
}
