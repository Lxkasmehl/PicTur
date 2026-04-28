/**
 * Backup-window API — feeds the admin-page countdown overlay with the
 * next chronodrop start time and expected duration.
 */

import { getToken, TURTLE_API_BASE_URL } from './config';

export interface BackupWindow {
  /** Unix seconds. Absolute timestamp for the next chronodrop start. */
  next_start_unix: number;
  /** Conservative upper bound for how long the UI should treat the system as in maintenance. */
  duration_seconds: number;
  schedule_hour: number;
  schedule_minute: number;
  server_tz: string;
}

export const getBackupWindow = async (): Promise<BackupWindow> => {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const response = await fetch(`${TURTLE_API_BASE_URL}/backup/window`, {
    method: 'GET',
    headers,
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Failed to load backup window' }));
    throw new Error(err.error || 'Failed to load backup window');
  }
  return await response.json();
};
