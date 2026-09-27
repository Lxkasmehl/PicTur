/**
 * Data API of the database-backed research groups (Flask /api/v2/orgs/<slug>/...).
 * Carapace photos only; images come as signed URLs relative to the API base.
 */

import { TURTLE_API_BASE_URL, getToken } from './config';

export type TurtleSex = 'F' | 'M' | 'U';
export type TurtleStatus = 'active' | 'deceased' | 'released';

export interface Region {
  id: number;
  parent_id: number | null;
  name: string;
}

export interface TurtleSummary {
  id: number;
  primary_id: string;
  bio_id: string;
  name: string | null;
  sex: TurtleSex;
  species: string | null;
  region_id: number | null;
  status: TurtleStatus;
  reference_image_url: string | null;
  sighting_count: number;
  last_seen: string | null;
}

export interface Sighting {
  id: number;
  observed_at: string | null;
  region_id: number | null;
  lat: number | null;
  lon: number | null;
  observer_name: string | null;
  measurements: Record<string, unknown>;
  notes: string | null;
  created_at: string;
}

export interface TurtleImage {
  id: number;
  url: string;
  is_reference: boolean;
  sighting_id: number | null;
  created_at: string;
}

export interface TurtleDetail extends TurtleSummary {
  notes: string | null;
  extra: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  sightings: Sighting[];
  images: TurtleImage[];
}

export interface MatchCandidate {
  turtle_id: number;
  score: number;
  confidence: number;
  in_region: boolean;
  turtle?: TurtleSummary;
}

export interface Submission {
  id: number;
  status: 'pending' | 'approved' | 'rejected';
  match_state: 'pending' | 'done' | 'failed';
  image_url: string;
  uploader_email?: string | null;
  uploader_is_staff: boolean;
  observed_at: string | null;
  region_id: number | null;
  lat: number | null;
  lon: number | null;
  notes: string | null;
  candidates?: MatchCandidate[];
  resolved_turtle_id: number | null;
  resolved_at: string | null;
  created_at: string;
}

export interface NewTurtleFields {
  name?: string;
  sex?: TurtleSex;
  species?: string;
  region_id?: number | null;
  notes?: string;
}

/** Absolute URL for a signed media path returned by the API ("/v2/orgs/..."). */
export function mediaUrl(path: string | null | undefined, maxDim?: number): string | undefined {
  if (!path) return undefined;
  const url = `${TURTLE_API_BASE_URL}${path}`;
  return maxDim ? `${url}&max_dim=${maxDim}` : url;
}

async function request<T>(slug: string, path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (init.body && !(init.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${TURTLE_API_BASE_URL}/v2/orgs/${encodeURIComponent(slug)}${path}`, {
    ...init,
    headers,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((body as { error?: string }).error || `Request failed (${response.status})`);
  }
  return body as T;
}

// ---- regions ----

export async function getRegions(slug: string): Promise<Region[]> {
  return (await request<{ regions: Region[] }>(slug, '/regions')).regions;
}

export async function createRegion(slug: string, name: string, parentId: number | null): Promise<Region> {
  const body = JSON.stringify({ name, parent_id: parentId });
  return (await request<{ region: Region }>(slug, '/regions', { method: 'POST', body })).region;
}

export async function renameRegion(slug: string, id: number, name: string): Promise<Region> {
  const body = JSON.stringify({ name });
  return (await request<{ region: Region }>(slug, `/regions/${id}`, { method: 'PATCH', body })).region;
}

export async function deleteRegion(slug: string, id: number): Promise<void> {
  await request(slug, `/regions/${id}`, { method: 'DELETE' });
}

/** "Parent / Child" labels for region selects, sorted by path. */
export function regionOptions(regions: Region[]): { value: string; label: string }[] {
  const byId = new Map(regions.map((r) => [r.id, r]));
  const path = (r: Region): string => {
    const parts: string[] = [];
    let cur: Region | undefined = r;
    const seen = new Set<number>();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      parts.unshift(cur.name);
      cur = cur.parent_id != null ? byId.get(cur.parent_id) : undefined;
    }
    return parts.join(' / ');
  };
  return regions
    .map((r) => ({ value: String(r.id), label: path(r) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// ---- turtles ----

export async function getTurtles(
  slug: string,
  filters: { q?: string; region_id?: number | null; status?: string | null } = {},
): Promise<TurtleSummary[]> {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.region_id) params.set('region_id', String(filters.region_id));
  if (filters.status) params.set('status', filters.status);
  const qs = params.toString();
  return (await request<{ turtles: TurtleSummary[] }>(slug, `/turtles${qs ? `?${qs}` : ''}`)).turtles;
}

export async function getTurtle(slug: string, id: number): Promise<TurtleDetail> {
  return (await request<{ turtle: TurtleDetail }>(slug, `/turtles/${id}`)).turtle;
}

export async function updateTurtle(
  slug: string,
  id: number,
  patch: Partial<Pick<TurtleDetail, 'name' | 'sex' | 'species' | 'region_id' | 'status' | 'notes'>>,
): Promise<TurtleDetail> {
  const body = JSON.stringify(patch);
  return (await request<{ turtle: TurtleDetail }>(slug, `/turtles/${id}`, { method: 'PATCH', body })).turtle;
}

export async function deleteTurtle(slug: string, id: number): Promise<void> {
  await request(slug, `/turtles/${id}`, { method: 'DELETE' });
}

export async function setReferenceImage(slug: string, turtleId: number, imageId: number): Promise<TurtleDetail> {
  const body = JSON.stringify({ image_id: imageId });
  return (
    await request<{ turtle: TurtleDetail }>(slug, `/turtles/${turtleId}/reference`, { method: 'POST', body })
  ).turtle;
}

export async function deleteTurtleImage(slug: string, turtleId: number, imageId: number): Promise<void> {
  await request(slug, `/turtles/${turtleId}/images/${imageId}`, { method: 'DELETE' });
}

export async function updateSighting(
  slug: string,
  id: number,
  patch: Partial<Omit<Sighting, 'id' | 'created_at'>>,
): Promise<Sighting> {
  const body = JSON.stringify(patch);
  return (await request<{ sighting: Sighting }>(slug, `/sightings/${id}`, { method: 'PATCH', body })).sighting;
}

export async function deleteSighting(slug: string, id: number): Promise<void> {
  await request(slug, `/sightings/${id}`, { method: 'DELETE' });
}

// ---- submissions ----

export interface SubmissionInput {
  file: File;
  region_id?: number | null;
  observed_at?: string | null;
  lat?: number | null;
  lon?: number | null;
  notes?: string;
}

export async function createSubmission(slug: string, input: SubmissionInput): Promise<Submission> {
  const form = new FormData();
  form.append('file', input.file);
  if (input.region_id) form.append('region_id', String(input.region_id));
  if (input.observed_at) form.append('observed_at', input.observed_at);
  if (input.lat != null) form.append('lat', String(input.lat));
  if (input.lon != null) form.append('lon', String(input.lon));
  if (input.notes) form.append('notes', input.notes);
  return (await request<{ submission: Submission }>(slug, '/submissions', { method: 'POST', body: form }))
    .submission;
}

export async function getSubmissions(
  slug: string,
  status: 'pending' | 'approved' | 'rejected' | 'all' = 'pending',
): Promise<Submission[]> {
  return (await request<{ submissions: Submission[] }>(slug, `/submissions?status=${status}`)).submissions;
}

export async function getMySubmissions(slug: string): Promise<Submission[]> {
  return (await request<{ submissions: Submission[] }>(slug, '/submissions/mine')).submissions;
}

export async function getSubmission(slug: string, id: number): Promise<Submission> {
  return (await request<{ submission: Submission }>(slug, `/submissions/${id}`)).submission;
}

export async function rematchSubmission(slug: string, id: number, regionId: number | null): Promise<Submission> {
  const body = JSON.stringify({ region_id: regionId });
  return (await request<{ submission: Submission }>(slug, `/submissions/${id}/rematch`, { method: 'POST', body }))
    .submission;
}

export async function approveSubmission(
  slug: string,
  id: number,
  decision:
    | { turtle_id: number; set_reference?: boolean }
    | { new_turtle: NewTurtleFields },
): Promise<TurtleDetail> {
  const body = JSON.stringify(decision);
  return (await request<{ turtle: TurtleDetail }>(slug, `/submissions/${id}/approve`, { method: 'POST', body }))
    .turtle;
}

export async function rejectSubmission(slug: string, id: number): Promise<void> {
  await request(slug, `/submissions/${id}/reject`, { method: 'POST' });
}
