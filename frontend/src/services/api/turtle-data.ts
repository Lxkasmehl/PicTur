/**
 * Turtle row data — Google Sheets CRUD, mark-deceased, lookup, and list operations.
 */

import { getToken, TURTLE_API_BASE_URL } from './config';

export interface TurtleSheetsData {
  primary_id?: string;
  sheet_name?: string;
  transmitter_id?: string;
  /** Sheet column "Frequency" (legacy header "Freq") */
  freq?: string;
  id?: string;
  id2?: string;
  pit?: string;
  /** Legacy sheet header "Pic in 2024 Archive?" (still read from old tabs) */
  pic_in_2024_archive?: string;
  plastron_picture_in_archive?: string;
  carapace_picture_in_archive?: string;
  adopted?: string;
  ibutton?: string;
  /** Sheet column "Date DNA Extracted?" (legacy "DNA Extracted?") */
  dna_extracted?: string;
  cow_interactions?: string;
  date_1st_found?: string;
  species?: string;
  name?: string;
  sex?: string;
  ibutton_last_set?: string;
  last_assay_date?: string;
  dates_refound?: string;
  /** Sheet column between Dates refound and General Location */
  specific_location?: string;
  general_location?: string;
  location?: string;
  health_status?: string;
  /** Google Sheets column "Deceased?" — Yes / No */
  deceased?: string;
  notes?: string;
  transmitter_put_on_by?: string;
  transmitter_on_date?: string;
  transmitter_type?: string;
  transmitter_lifespan?: string;
  radio_replace_date?: string;
  old_frequencies?: string;
  mass_g?: string;
  flesh_flies?: string;
  curved_carapace_length_mm?: string;
  straight_carapace_length_mm?: string;
  carapace_width_mm?: string;
  curved_plastron_length_mm?: string;
  straight_plastron_length_mm?: string;
  plastron_p1_mm?: string;
  plastron_p2_mm?: string;
  plastron_width_mm?: string;
  dome_height_mm?: string;
  /** Google Sheet row (1-based header excluded); set when listing from /api/sheets/turtles */
  row_index?: number;
}

/**
 * On-disk folder / ref_data stem: biology **ID** column when set (e.g. F439), else **Primary ID**.
 */
export function turtleDiskFolderId(
  t: Pick<TurtleSheetsData, 'id' | 'primary_id'>,
): string {
  const bio = (t.id || '').trim();
  if (bio) return bio;
  return (t.primary_id || '').trim();
}

/**
 * Folder hint for turtle image APIs: matches `data/<...>/` on disk.
 * The on-disk top-level folder IS the spreadsheet tab (`sheet_name`, e.g.
 * `Kansas`, `NebraskaCPBS`); `general_location` / `location` are subpaths under
 * it. Lead with the tab so the backend scopes the lookup to the correct sheet —
 * biology IDs repeat across sheets, so a hint missing the tab can resolve to
 * the wrong turtle's photos.
 */
export function turtleDataFolderHint(
  t: Pick<TurtleSheetsData, 'sheet_name' | 'general_location' | 'location'>,
): string | null {
  const gl = (t.general_location || '').trim().replace(/\\/g, '/');
  const loc = (t.location || '').trim().replace(/\\/g, '/');
  const sheet = (t.sheet_name || '').trim();
  const segs = [sheet, gl, loc].filter(Boolean);
  // Drop consecutive duplicate segments (e.g. a sheet whose tab name equals its
  // general_location) so the hint doesn't become `Kansas/Kansas/...`.
  const deduped = segs.filter((s, i) => i === 0 || s !== segs[i - 1]);
  return deduped.length ? deduped.join('/') : null;
}

export interface GetTurtleSheetsDataResponse {
  success: boolean;
  data?: TurtleSheetsData;
  message?: string;
  exists?: boolean;
}

export interface CreateTurtleSheetsDataRequest {
  sheet_name: string;
  state?: string;
  location?: string;
  turtle_data: TurtleSheetsData;
  /** When 'community', create in community-facing spreadsheet. Default 'research'. */
  target_spreadsheet?: 'research' | 'community';
}

export interface CreateTurtleSheetsDataResponse {
  success: boolean;
  primary_id?: string;
  message?: string;
  error?: string;
}

export interface UpdateTurtleSheetsDataRequest {
  sheet_name: string;
  state?: string;
  location?: string;
  turtle_data: Partial<TurtleSheetsData>;
  /** When 'community', update in community spreadsheet. Default 'research'. */
  target_spreadsheet?: 'research' | 'community';
}

export interface UpdateTurtleSheetsDataResponse {
  success: boolean;
  message?: string;
  error?: string;
}

export interface MarkTurtleDeceasedRequest {
  sheet_name: string;
  primary_id?: string;
  biology_id?: string;
  id?: string;
  name?: string;
  deceased?: boolean;
  target_spreadsheet?: 'research' | 'community';
}

export interface MarkTurtleDeceasedMatch {
  row_index: number;
  primary_id: string;
  id: string;
  name: string;
}

export interface MarkTurtleDeceasedResponse {
  success: boolean;
  primary_id?: string;
  biology_id?: string;
  name?: string;
  deceased?: string;
  message?: string;
  error?: string;
  matches?: MarkTurtleDeceasedMatch[];
}

export type TurtleLookupField = 'primary_id' | 'biology_id' | 'name';

export interface GetTurtleLookupOptionsResponse {
  success: boolean;
  options?: string[];
  count?: number;
  error?: string;
}

export interface TurtleNameEntry {
  name: string;
  primary_id: string;
}

export interface ListTurtleNamesResponse {
  success: boolean;
  names: TurtleNameEntry[];
  error?: string;
}

export interface ListTurtlesResponse {
  success: boolean;
  turtles: TurtleSheetsData[];
  count: number;
  error?: string;
}

export const getTurtleSheetsData = async (
  primaryId: string,
  sheetName?: string,
  state?: string,
  location?: string,
  signal?: AbortSignal,
): Promise<GetTurtleSheetsDataResponse> => {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const params = new URLSearchParams();
  if (sheetName) params.append('sheet_name', sheetName);
  if (state) params.append('state', state);
  if (location) params.append('location', location);

  const response = await fetch(
    `${TURTLE_API_BASE_URL}/sheets/turtle/${primaryId}${params.toString() ? `?${params.toString()}` : ''}`,
    { method: 'GET', headers, signal },
  );
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to get turtle data from sheets');
  }
  return await response.json();
};

export const createTurtleSheetsData = async (
  data: CreateTurtleSheetsDataRequest,
): Promise<CreateTurtleSheetsDataResponse> => {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(`${TURTLE_API_BASE_URL}/sheets/turtle`, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create turtle data in sheets');
  }
  return await response.json();
};

export const updateTurtleSheetsData = async (
  primaryId: string,
  data: UpdateTurtleSheetsDataRequest,
): Promise<UpdateTurtleSheetsDataResponse> => {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(`${TURTLE_API_BASE_URL}/sheets/turtle/${primaryId}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update turtle data in sheets');
  }
  return await response.json();
};

export const markTurtleDeceased = async (
  body: MarkTurtleDeceasedRequest,
): Promise<MarkTurtleDeceasedResponse> => {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const response = await fetch(`${TURTLE_API_BASE_URL}/sheets/turtle/mark-deceased`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as MarkTurtleDeceasedResponse;
  if (!response.ok) throw new Error(data.error || 'Failed to update deceased status');
  return data;
};

export const getTurtleLookupOptions = async (
  sheetName: string,
  field: TurtleLookupField,
  targetSpreadsheet: 'research' | 'community' = 'research',
): Promise<GetTurtleLookupOptionsResponse> => {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const params = new URLSearchParams({ sheet_name: sheetName, field });
  if (targetSpreadsheet !== 'research') params.set('target_spreadsheet', targetSpreadsheet);
  const response = await fetch(
    `${TURTLE_API_BASE_URL}/sheets/mark-deceased/lookup-options?${params.toString()}`,
    { method: 'GET', headers },
  );
  const data = (await response.json()) as GetTurtleLookupOptionsResponse & {
    exists?: boolean;
    data?: unknown;
  };
  if (!response.ok) {
    return { success: false, options: [], error: data.error || 'Failed to load options' };
  }
  if (!Array.isArray(data.options)) {
    return {
      success: false,
      options: [],
      error: 'Unexpected API response. Ensure the backend is updated (mark-deceased lookup-options route).',
    };
  }
  return data;
};

export const getTurtleNames = async (): Promise<ListTurtleNamesResponse> => {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const response = await fetch(`${TURTLE_API_BASE_URL}/sheets/turtle-names`, {
    method: 'GET',
    headers,
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to list turtle names');
  }
  return await response.json();
};

export const listAllTurtlesFromSheets = async (
  sheetName?: string,
): Promise<ListTurtlesResponse> => {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const params = new URLSearchParams();
  if (sheetName) params.append('sheet', sheetName);
  const response = await fetch(
    `${TURTLE_API_BASE_URL}/sheets/turtles?${params.toString()}`,
    { method: 'GET', headers },
  );
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to list turtles from sheets');
  }
  return await response.json();
};
