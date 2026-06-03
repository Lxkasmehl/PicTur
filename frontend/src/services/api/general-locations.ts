/**
 * General Location catalog — state-specific dropdown options for admin turtle data entry.
 */

import { getToken, TURTLE_API_BASE_URL } from './config';

export interface GeneralLocationCatalog {
  states: Record<string, string[]>;
  sheet_defaults: Record<string, { state: string; general_location: string }>;
}

export interface GeneralLocationCatalogResponse {
  success: boolean;
  catalog?: GeneralLocationCatalog;
  states?: { state: string; locations: string[] }[];
  sheet_defaults?: { sheet_name: string; state: string; general_location: string }[];
  error?: string;
}

export interface AddGeneralLocationRequest {
  state: string;
  general_location: string;
}

export interface AddGeneralLocationResponse extends GeneralLocationCatalogResponse {
  synced?: boolean;
  sheets_updated?: number;
  sync_error?: string;
  /** Present when Sheets API ran but no tab was updated (e.g. missing header). */
  sync_warning?: string;
  message?: string;
}

export interface AffectedTurtlesResponse {
  success: boolean;
  total: number;
  sheets: { sheet_name: string; count: number }[];
  error?: string;
}

export interface DeleteGeneralLocationRequest {
  state: string;
  general_location: string;
  target_general_location?: string;
  /** When true: bypasses the locked-default check and removes any sheet_defaults referencing this location. */
  force?: boolean;
}

export interface SheetDefaultRequest {
  sheet_name: string;
  general_location: string;
}

export interface RemoveSheetDefaultRequest {
  sheet_name: string;
}

export interface DeleteGeneralLocationResponse extends GeneralLocationCatalogResponse {
  synced?: boolean;
  sheets_updated?: number;
  sync_error?: string;
  moved?: number;
  /** When turtles exist and no target was given, the server returns these. */
  total?: number;
  sheets?: { sheet_name: string; count: number }[];
}

export const getGeneralLocationCatalog = async (): Promise<GeneralLocationCatalogResponse> => {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const response = await fetch(`${TURTLE_API_BASE_URL}/general-locations`, {
    method: 'GET',
    headers,
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to load general locations');
  }
  return await response.json();
};

export const addGeneralLocation = async (
  data: AddGeneralLocationRequest,
): Promise<AddGeneralLocationResponse> => {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const response = await fetch(`${TURTLE_API_BASE_URL}/general-locations`, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to add general location');
  }
  return await response.json();
};

export const getAffectedTurtleCount = async (
  generalLocation: string,
  state?: string,
): Promise<AffectedTurtlesResponse> => {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const params = new URLSearchParams({ general_location: generalLocation });
  if (state) params.set('state', state);
  const response = await fetch(
    `${TURTLE_API_BASE_URL}/general-locations/affected-turtles?${params.toString()}`,
    { method: 'GET', headers },
  );
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to count affected turtles');
  }
  return await response.json();
};

export const addSheetDefault = async (
  data: SheetDefaultRequest,
): Promise<AddGeneralLocationResponse> => {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const response = await fetch(`${TURTLE_API_BASE_URL}/general-locations/sheet-defaults`, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to add sheet default');
  }
  return await response.json();
};

export const removeSheetDefault = async (
  data: RemoveSheetDefaultRequest,
): Promise<GeneralLocationCatalogResponse> => {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const response = await fetch(`${TURTLE_API_BASE_URL}/general-locations/sheet-defaults`, {
    method: 'DELETE',
    headers,
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to remove sheet default');
  }
  return await response.json();
};

export const deleteGeneralLocation = async (
  data: DeleteGeneralLocationRequest,
): Promise<DeleteGeneralLocationResponse> => {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const response = await fetch(`${TURTLE_API_BASE_URL}/general-locations`, {
    method: 'DELETE',
    headers,
    body: JSON.stringify(data),
  });
  const result = (await response.json()) as DeleteGeneralLocationResponse;
  if (!response.ok && result.error !== 'turtles_exist') {
    throw new Error(result.error || 'Failed to delete general location');
  }
  return result;
};
