import type { PhotoType, TurtleMatch } from '../../services/api';

/**
 * A match candidate as stored in localStorage. Extends the API {@link TurtleMatch}
 * with the camelCase scope flag mapped from the API's per-candidate `in_scope`
 * (PR-4). Absent `inScope` = in scope (global users / legacy stored payloads).
 */
export interface StoredMatchCandidate extends TurtleMatch {
  inScope?: boolean;
}

export interface MatchData {
  request_id: string;
  uploaded_image_path: string;
  matches: StoredMatchCandidate[];
  photo_type?: PhotoType;
  /**
   * Mapped from the API's top-level `scope_expanded` (PR-4). When true the whole
   * match page is read-only. Absent/false = fully editable (as before PR-4).
   */
  scopeExpanded?: boolean;
}

export type CrossCheckMatch = {
  turtle_id: string;
  location: string;
  confidence: number;
  score: number;
  image_path: string;
};

export type CandidateSummary = {
  primary_id?: string;
  name?: string;
  bio_id?: string;
};

/**
 * Extract the lookup id from a folder basename so the Sheets API can find the row.
 */
export function lookupIdFromTurtleId(turtleId: string): string {
  if (!turtleId || !turtleId.includes('_')) return turtleId;
  const parts = turtleId.split('_').filter(Boolean);
  const primaryLike = parts.find((p) => /^T\d{5,}$/i.test(p));
  if (primaryLike) return primaryLike;
  const bioLike = parts.find((p) => /^[FMJU]\d+$/i.test(p));
  if (bioLike) return bioLike;
  return turtleId;
}

/** Normalized ``state/location/…`` hint for image APIs (matches disk under ``data/``). */
export function dataPathHintFromMatchLocation(
  location: string | undefined | null,
): string | null {
  const v = (location || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  return v || null;
}

export function candidateSummaryKey(turtleId: string, location: string): string {
  return `${turtleId}|${location}`;
}
