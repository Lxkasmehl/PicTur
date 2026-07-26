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

export interface MergeTurtlesParams {
  primaryId: string;
  secondaryId: string;
  primarySheet: string;
  secondarySheet: string;
  plastronSource: 'primary' | 'secondary';
  carapaceSource: 'primary' | 'secondary';
  /** Absolute filesystem paths of secondary additional images to migrate. */
  keepSecondaryAdditional: string[];
}

export const mergeTurtles = async (
  params: MergeTurtlesParams,
): Promise<{ success: boolean; message: string }> => {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const response = await fetch(`${TURTLE_API_BASE_URL}/turtles/merge`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      primary_id: params.primaryId,
      secondary_id: params.secondaryId,
      primary_sheet: params.primarySheet,
      secondary_sheet: params.secondarySheet,
      plastron_source: params.plastronSource,
      carapace_source: params.carapaceSource,
      keep_secondary_additional: params.keepSecondaryAdditional,
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || data.message || 'Failed to merge turtles');
  }
  return data as { success: boolean; message: string };
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


/** What to download: everything the caller may see, or one area (a State folder
 *  or a `State/Location` path). The server resolves + CLAMPS this against the
 *  caller's group areas at token-mint time, so a team lead can only ever get
 *  their own areas. */
export type BackupScope = { scope: 'all' } | { scope: 'area'; area: string };

/**
 * Team-lead/admin: download a ZIP of (part of) the backend data/ mirror + the
 * matching Google Sheets CSV/JSON exports.
 *
 * The archive is multi-GB, so we do NOT buffer it (no fetch -> blob): the
 * server streams it in constant memory. Because a navigation/anchor download
 * can't send the Authorization header, we first mint a short-lived capability
 * token (authenticated via the header; the token embeds the resolved+clamped
 * scope) and then hand the ?dl= URL to the browser's own download manager,
 * which streams straight to disk in the background. `timeoutMs` bounds only the
 * small token request.
 */
export async function downloadAdminBackupArchive(
  options: BackupScope,
  timeoutMs = 30000,
): Promise<void> {
  const token = getToken();
  if (!token) throw new Error('Not authenticated');

  const params = new URLSearchParams({ scope: options.scope });
  if (options.scope === 'area') params.set('area', options.area);

  // 1) Mint a short-lived download token (authenticated via the header).
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  let dlToken: string;
  try {
    const res = await fetch(
      `${TURTLE_API_BASE_URL}/backup/archive/token?${params.toString()}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      },
    );
    clearTimeout(timeoutId);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { error?: string }).error || 'Backup authorization failed');
    }
    const data = (await res.json()) as { token?: string };
    if (!data.token) {
      throw new Error('Backup authorization failed: no token returned');
    }
    dlToken = data.token;
  } catch (e) {
    clearTimeout(timeoutId);
    if (e instanceof Error && e.name === 'AbortError') throw new Error(`Request timed out after ${timeoutMs}ms`);
    throw e;
  }

  // 2) Hand off to the browser's download manager (streams to disk; the
  //    response's Content-Disposition names the file).
  params.set('dl', dlToken);
  const url = `${TURTLE_API_BASE_URL}/backup/archive?${params.toString()}`;
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
