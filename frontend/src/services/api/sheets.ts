/**
 * Google Sheets API — barrel re-export + sheet-tab management, ID generation,
 * locations, and backup archive download.
 *
 * Sub-modules:
 *   turtle-data.ts       — TurtleSheetsData type, CRUD, mark-deceased, lookup
 *   general-locations.ts — General Location catalog management
 */

export * from './turtle-data';
export * from './general-locations';

import { getToken, TURTLE_API_BASE_URL } from './config';

// ---------------------------------------------------------------------------
// Sheet-tab management
// ---------------------------------------------------------------------------

export interface ListSheetsResponse {
  success: boolean;
  sheets?: string[];
  error?: string;
}

export interface GetLocationsResponse {
  success: boolean;
  locations?: string[];
  error?: string;
}

export interface CreateSheetRequest {
  sheet_name: string;
  /** When 'community', create in community-facing spreadsheet. Default 'research'. */
  target_spreadsheet?: 'research' | 'community';
}

export interface CreateSheetResponse {
  success: boolean;
  message?: string;
  sheets?: string[];
  error?: string;
}

export const listSheets = async (timeoutMs = 25000): Promise<ListSheetsResponse> => {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${TURTLE_API_BASE_URL}/sheets/sheets`, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to list sheets');
    }
    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') throw new Error(`Request timeout after ${timeoutMs}ms`);
    throw error;
  }
};

export const listCommunitySheets = async (timeoutMs = 25000): Promise<ListSheetsResponse> => {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${TURTLE_API_BASE_URL}/sheets/community-sheets`, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Failed to list community sheets');
    }
    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') throw new Error(`Request timeout after ${timeoutMs}ms`);
    throw error;
  }
};

export const getLocations = async (): Promise<GetLocationsResponse> => {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const response = await fetch(`${TURTLE_API_BASE_URL}/locations`, { method: 'GET', headers });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to load locations');
  }
  return await response.json();
};

export const createSheet = async (data: CreateSheetRequest): Promise<CreateSheetResponse> => {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const response = await fetch(`${TURTLE_API_BASE_URL}/sheets/sheets`, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create sheet');
  }
  return await response.json();
};

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

export interface GeneratePrimaryIdRequest {
  state: string;
  location?: string;
}

export interface GeneratePrimaryIdResponse {
  success: boolean;
  primary_id?: string;
  error?: string;
}

export interface GenerateTurtleIdRequest {
  sex: string; // M, F, J, or U
  sheet_name: string;
  /** When 'community', use community spreadsheet for ID generation. */
  target_spreadsheet?: 'research' | 'community';
}

export interface GenerateTurtleIdResponse {
  success: boolean;
  id?: string;
  error?: string;
}

export const generatePrimaryId = async (
  data: GeneratePrimaryIdRequest,
  timeoutMs = 15000,
): Promise<GeneratePrimaryIdResponse> => {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${TURTLE_API_BASE_URL}/sheets/generate-primary-id`, {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to generate primary ID');
    }
    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') throw new Error(`Request timeout after ${timeoutMs}ms`);
    throw error;
  }
};

export const generateTurtleId = async (
  data: GenerateTurtleIdRequest,
  timeoutMs = 10000,
): Promise<GenerateTurtleIdResponse> => {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${TURTLE_API_BASE_URL}/sheets/generate-id`, {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to generate turtle ID');
    }
    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') throw new Error(`Request timeout after ${timeoutMs}ms`);
    throw error;
  }
};

// ---------------------------------------------------------------------------
// Backup archive download
// ---------------------------------------------------------------------------

/**
 * Admin-only: download ZIP with backend data/ mirror + Google Sheets CSV/JSON exports.
 * Triggers a browser file download.
 */
export async function downloadAdminBackupArchive(
  options: { scope: 'all' } | { scope: 'sheet'; sheet: string },
  timeoutMs = 600000,
): Promise<void> {
  const token = getToken();
  if (!token) throw new Error('Not authenticated');

  const params = new URLSearchParams({ scope: options.scope });
  if (options.scope === 'sheet') params.set('sheet', options.sheet);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      `${TURTLE_API_BASE_URL}/backup/archive?${params.toString()}`,
      { method: 'GET', headers: { Authorization: `Bearer ${token}` }, signal: controller.signal },
    );
    clearTimeout(timeoutId);

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error((err as { error?: string }).error || 'Backup download failed');
    }

    const blob = await response.blob();
    const cd = response.headers.get('Content-Disposition');
    let filename = 'turtle-backup.zip';
    const m = cd && /filename="([^"]+)"/.exec(cd);
    if (m) filename = m[1];

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    clearTimeout(timeoutId);
    if (e instanceof Error && e.name === 'AbortError') throw new Error(`Request timed out after ${timeoutMs}ms`);
    throw e;
  }
}
