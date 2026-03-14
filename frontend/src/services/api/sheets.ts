/**
 * Google Sheets API – turtle data, sheets list, primary ID, etc.
 */

import { getToken, TURTLE_API_BASE_URL } from './config';

export interface TurtleSheetsData {
  primary_id?: string;
  sheet_name?: string; // Which Google Sheets tab this turtle belongs to
  transmitter_id?: string;
  id?: string;
  id2?: string;
  pit?: string;
  pic_in_2024_archive?: string;
  adopted?: string;
  ibutton?: string;
  dna_extracted?: string;
  date_1st_found?: string;
  species?: string;
  name?: string;
  sex?: string;
  ibutton_last_set?: string;
  last_assay_date?: string;
  dates_refound?: string;
  general_location?: string;
  location?: string;
  health_status?: string;
  notes?: string;
  transmitter_put_on_by?: string;
  transmitter_on_date?: string;
  transmitter_type?: string;
  transmitter_lifespan?: string;
  radio_replace_date?: string;
  old_frequencies?: string;
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
