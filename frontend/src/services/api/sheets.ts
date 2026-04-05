/**
 * Google Sheets API – turtle data, sheets list, primary ID, etc.
 */

import { getToken, TURTLE_API_BASE_URL } from './config';

export interface TurtleSheetsData {
  primary_id?: string;
  sheet_name?: string; // Which Google Sheets tab this turtle belongs to
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
  // Optional mass and morphometrics (sheet headers CCL, Cflat, …; legacy long names still read)
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
}

export interface GetTurtleSheetsDataResponse {
  success: boolean;
  data?: TurtleSheetsData;
  message?: string;
  exists?: boolean;
}

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

export interface GeneratePrimaryIdRequest {
  state: string;
  location?: string;
}

export interface GeneratePrimaryIdResponse {
  success: boolean;
  primary_id?: string;
  error?: string;
}

export interface CreateTurtleSheetsDataRequest {
  sheet_name: string;
  state?: string;
  location?: string;
  turtle_data: TurtleSheetsData;
  /** When 'community', create in community-facing spreadsheet (e.g. review queue community upload). Default 'research'. */
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

export interface GenerateTurtleIdRequest {
  sex: string; // M, F, J, or U
  sheet_name: string;
  /** When 'community', use community spreadsheet for ID generation (do not create sheet in research). */
  target_spreadsheet?: 'research' | 'community';
}

export interface GenerateTurtleIdResponse {
  success: boolean;
  id?: string;
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

// Get turtle data from Google Sheets
export const getTurtleSheetsData = async (
  primaryId: string,
  sheetName?: string,
  state?: string,
  location?: string,
  signal?: AbortSignal,
): Promise<GetTurtleSheetsDataResponse> => {
  const token = getToken();
  const headers: Record<string, string> = {};

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const params = new URLSearchParams();
  if (sheetName) {
    params.append('sheet_name', sheetName);
  }
  if (state) {
    params.append('state', state);
  }
  if (location) {
    params.append('location', location);
  }

  const response = await fetch(
    `${TURTLE_API_BASE_URL}/sheets/turtle/${primaryId}${params.toString() ? `?${params.toString()}` : ''}`,
    {
      method: 'GET',
      headers,
      signal,
    },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to get turtle data from sheets');
  }

  return await response.json();
};

// Create turtle data in Google Sheets
export const createTurtleSheetsData = async (
  data: CreateTurtleSheetsDataRequest,
): Promise<CreateTurtleSheetsDataResponse> => {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

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

// Update turtle data in Google Sheets
export const updateTurtleSheetsData = async (
  primaryId: string,
  data: UpdateTurtleSheetsDataRequest,
): Promise<UpdateTurtleSheetsDataResponse> => {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(
    `${TURTLE_API_BASE_URL}/sheets/turtle/${primaryId}`,
    {
      method: 'PUT',
      headers,
      body: JSON.stringify(data),
    },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update turtle data in sheets');
  }

  return await response.json();
};

/** Mark deceased without plastron ID: lookup by primary_id, biology id, or name within one sheet tab. */
export const markTurtleDeceased = async (
  body: MarkTurtleDeceasedRequest,
): Promise<MarkTurtleDeceasedResponse> => {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const response = await fetch(`${TURTLE_API_BASE_URL}/sheets/turtle/mark-deceased`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as MarkTurtleDeceasedResponse;
  if (!response.ok) {
    throw new Error(data.error || 'Failed to update deceased status');
  }
  return data;
};

/** Distinct values from ID / Name / Primary ID column in one sheet tab (for mark-deceased picker). */
export const getTurtleLookupOptions = async (
  sheetName: string,
  field: TurtleLookupField,
  targetSpreadsheet: 'research' | 'community' = 'research',
): Promise<GetTurtleLookupOptionsResponse> => {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const params = new URLSearchParams({
    sheet_name: sheetName,
    field,
  });
  if (targetSpreadsheet !== 'research') {
    params.set('target_spreadsheet', targetSpreadsheet);
  }
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
  // Wrong route (e.g. matched as GET /turtle/<primary_id>) returns turtle payload without options
  if (!Array.isArray(data.options)) {
    return {
      success: false,
      options: [],
      error: 'Unexpected API response. Ensure the backend is updated (mark-deceased lookup-options route).',
    };
  }
  return data;
};

// Generate a new primary ID
export const generatePrimaryId = async (
  data: GeneratePrimaryIdRequest,
  timeoutMs: number = 15000,
): Promise<GeneratePrimaryIdResponse> => {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      `${TURTLE_API_BASE_URL}/sheets/generate-primary-id`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(data),
        signal: controller.signal,
      },
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to generate primary ID');
    }

    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  }
};

// Generate the next biology ID (ID column) based on sex: M/F/J/U + sequence number
export const generateTurtleId = async (
  data: GenerateTurtleIdRequest,
  timeoutMs: number = 10000,
): Promise<GenerateTurtleIdResponse> => {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
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
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  }
};

// List all available sheets
export const listSheets = async (
  timeoutMs: number = 25000,
): Promise<ListSheetsResponse> => {
  const token = getToken();
  const headers: Record<string, string> = {};

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

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
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  }
};

// List sheet (tab) names from the community-facing spreadsheet (for Review Queue – community uploads)
export const listCommunitySheets = async (
  timeoutMs: number = 25000,
): Promise<ListSheetsResponse> => {
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
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  }
};

// List backend location paths (State/Location) for community upload and manual upload
export const getLocations = async (): Promise<GetLocationsResponse> => {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const response = await fetch(`${TURTLE_API_BASE_URL}/locations`, {
    method: 'GET',
    headers,
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to load locations');
  }
  return await response.json();
};

// Shared catalog of state-specific General Location options
export const getGeneralLocationCatalog = async (): Promise<GeneralLocationCatalogResponse> => {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
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
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
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

// List all turtle names across sheets (for duplicate-name validation)
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

// Create a new sheet with headers
export const createSheet = async (
  data: CreateSheetRequest,
): Promise<CreateSheetResponse> => {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

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

// List all turtles from Google Sheets
export const listAllTurtlesFromSheets = async (
  sheetName?: string,
): Promise<ListTurtlesResponse> => {
  const token = getToken();
  const headers: Record<string, string> = {};

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const params = new URLSearchParams();
  if (sheetName) {
    params.append('sheet', sheetName);
  }

  const response = await fetch(
    `${TURTLE_API_BASE_URL}/sheets/turtles?${params.toString()}`,
    {
      method: 'GET',
      headers,
    },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to list turtles from sheets');
  }

  return await response.json();
};
