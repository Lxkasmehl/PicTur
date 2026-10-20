/**
 * Turtle data columns of a database-backed research group (Flask /api/turtle-columns).
 * The main group always uses the fixed columns of its Google Sheet.
 */

import { getToken, TURTLE_API_BASE_URL } from './config';

export type CustomColumnType = 'text' | 'number' | 'date' | 'select' | 'yesno' | 'textarea';

export interface StandardColumn {
  key: string;
  header: string;
  required: boolean;
  enabled: boolean;
}

export interface CustomColumn {
  /** Stable field key (custom_...); assigned by the backend for new columns. */
  key?: string;
  label: string;
  type: CustomColumnType;
  options?: string[];
}

export interface TurtleColumnsResponse {
  success: boolean;
  configurable: boolean;
  standard: StandardColumn[];
  custom: CustomColumn[];
  warning?: string;
}

export interface TurtleColumnsInput {
  standard: string[];
  custom: CustomColumn[];
}

/** Editor value (enabled standard keys + own columns) from a GET /api/turtle-columns response. */
export function columnsInputFrom(standard: StandardColumn[], custom: CustomColumn[]): TurtleColumnsInput {
  return { standard: standard.filter((c) => c.enabled).map((c) => c.key), custom };
}

function headers(slug?: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) h['Authorization'] = `Bearer ${token}`;
  // Explicit group (e.g. right after creating one on the Research Groups page)
  if (slug) h['X-Org-Slug'] = slug;
  return h;
}

async function parse(response: Response, fallback: string): Promise<TurtleColumnsResponse> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error || fallback);
  return body as TurtleColumnsResponse;
}

export async function getTurtleColumns(slug?: string): Promise<TurtleColumnsResponse> {
  const r = await fetch(`${TURTLE_API_BASE_URL}/turtle-columns`, { headers: headers(slug) });
  return parse(r, 'Failed to load the data fields');
}

export async function setTurtleColumns(input: TurtleColumnsInput, slug?: string): Promise<TurtleColumnsResponse> {
  const r = await fetch(`${TURTLE_API_BASE_URL}/turtle-columns`, {
    method: 'POST',
    headers: headers(slug),
    body: JSON.stringify(input),
  });
  return parse(r, 'Failed to save the data fields');
}
