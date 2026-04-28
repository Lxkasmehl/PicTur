/**
 * PicTur API – photo upload, review queue, matching
 */

import { getToken, removeToken, TURTLE_API_BASE_URL } from './config';
import type { TurtleSheetsData } from './sheets';

export interface TurtleMatch {
  turtle_id: string;
  location: string;
  confidence: number;
  file_path: string;
  filename: string;
}

export type PhotoType = 'plastron' | 'carapace' | 'unclassified';

export interface UploadPhotoResponse {
  success: boolean;
  request_id?: string;
  matches?: TurtleMatch[];
  uploaded_image_path?: string;
  photo_type?: PhotoType;
  message: string;
}

/** Location hint from community (never stored in sheets, queue/display only) */
export interface LocationHint {
  latitude: number;
  longitude: number;
  source: 'gps' | 'manual';
}

/** Additional image (microhabitat, condition, carapace) in a review packet */
export interface AdditionalImage {
  filename: string;
  type: string;
  labels?: string[];
  timestamp?: string;
  image_path: string;
}

export interface ReviewQueueItem {
  request_id: string;
  uploaded_image: string;
  metadata: {
    finder?: string;
    email?: string;
    uploaded_at?: number;
    state?: string;
    location?: string;
    /** Hint only – never stored in sheets */
    location_hint_lat?: number;
    location_hint_lon?: number;
    location_hint_source?: 'gps' | 'manual';
    collected_to_lab?: string;
    physical_flag?: string;
    digital_flag_lat?: number;
    digital_flag_lon?: number;
    digital_flag_source?: 'gps' | 'manual';
  };
  /** Microhabitat / condition photos uploaded with this find */
  additional_images?: AdditionalImage[];
  candidates: Array<{
    rank: number;
    turtle_id: string;
    confidence: number;
    image_path: string;
  }>;
  /** True while SuperPoint matching has not finished (candidate_matches dir not created yet). */
  match_search_pending?: boolean;
  /** True when matching errored before candidate_matches was created (see match_search_error). */
  match_search_failed?: boolean;
  /** Server error message when match_search_failed is true. */
  match_search_error?: string | null;
  status: string;
  photo_type?: PhotoType;
}

/** Flag/microhabitat data sent when approving a review (new or matched turtle) */
export interface FindMetadata {
  microhabitat_uploaded?: boolean;
  other_angles_uploaded?: boolean;
  collected_to_lab?: 'yes' | 'no';
  physical_flag?: 'yes' | 'no' | 'no_flag';
  digital_flag_lat?: number;
  digital_flag_lon?: number;
  digital_flag_source?: 'gps' | 'manual';
}

export interface ReviewQueueResponse {
  success: boolean;
  items: ReviewQueueItem[];
}

export interface ApproveReviewRequest {
  match_turtle_id?: string;
  new_location?: string;
  new_turtle_id?: string;
  uploaded_image_path?: string;
  sheets_data?: TurtleSheetsData & { sheet_name?: string; primary_id?: string };
  find_metadata?: FindMetadata;
  /** When the matched turtle is from the community spreadsheet (admin re-found it). Backend will move folder and remove from community sheet. */
  match_from_community?: boolean;
  /** Community sheet tab name where the turtle currently lives (e.g. "Unknown"). Required when match_from_community is true. */
  community_sheet_name?: string;
  /** Photo type: plastron (belly, default) or carapace (top of shell). */
  photo_type?: PhotoType;
  /** Replace the existing plastron reference image with this upload (old image archived). */
  replace_reference?: boolean;
  /** Replace the existing carapace reference using the first carapace additional image. */
  replace_carapace_reference?: boolean;
}

/** Optional flag/collected-to-lab and extra images for upload (community flow) */
export interface UploadFlagOptions {
  collectedToLab?: 'yes' | 'no';
  physicalFlag?: 'yes' | 'no' | 'no_flag';
  digitalFlag?: LocationHint;
}

export interface UploadExtraFile {
  type: 'microhabitat' | 'condition' | 'carapace' | 'plastron' | 'additional' | 'other';
  file: File;
  /** Stored as searchable tags on the additional image (same request as upload). */
  labels?: string[];
  /** Client-only stable key for list previews (not sent to API). */
  localId?: string;
}

export interface ApproveReviewResponse {
  success: boolean;
  message: string;
}

// Upload photo (Admin or Community)
export const uploadTurtlePhoto = async (
  file: File,
  _role: 'admin' | 'staff' | 'community',
  _email: string,
  location?: { state: string; location: string },
  /** Optional: coordinates as hint only (never stored in sheets) */
  locationHint?: LocationHint,
  /** Admin only: sheet name (location) to test against; '' or undefined = test against all locations */
  matchSheet?: string,
  /** Optional: collected to lab / physical flag / digital flag (community upload) */
  flagOptions?: UploadFlagOptions,
  /** Optional: microhabitat or condition photos (community upload, same request) */
  extraFiles?: UploadExtraFile[],
): Promise<UploadPhotoResponse> => {
  const formData = new FormData();
  formData.append('file', file);

  if (location) {
    formData.append('state', location.state);
    formData.append('location', location.location);
  }
  if (matchSheet !== undefined) {
    formData.append('match_sheet', matchSheet);
  }
  if (locationHint) {
    formData.append('location_hint_lat', String(locationHint.latitude));
    formData.append('location_hint_lon', String(locationHint.longitude));
    formData.append('location_hint_source', locationHint.source);
  }
  if (flagOptions) {
    if (flagOptions.collectedToLab) formData.append('collected_to_lab', flagOptions.collectedToLab);
    if (flagOptions.physicalFlag) formData.append('physical_flag', flagOptions.physicalFlag);
    if (flagOptions.digitalFlag) {
      formData.append('digital_flag_lat', String(flagOptions.digitalFlag.latitude));
      formData.append('digital_flag_lon', String(flagOptions.digitalFlag.longitude));
      formData.append('digital_flag_source', flagOptions.digitalFlag.source);
    }
  }
  if (extraFiles?.length) {
    extraFiles.forEach((ef, i) => {
      formData.append(`extra_${ef.type}_${i}`, ef.file);
      if (ef.labels?.length) {
        formData.append(`extra_labels_${i}`, ef.labels.join(', '));
      }
    });
  }

  const token = getToken();
  const headers: Record<string, string> = {};

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${TURTLE_API_BASE_URL}/upload`, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (!response.ok) {
    if (response.status === 401) {
      removeToken();
      throw new Error('Authentication failed. Please try again.');
    }
    const error = await response.json().catch(() => ({ error: 'Upload failed' }));
    const message = error.error || 'Upload failed';
    const details = error.details as string | undefined;
    if (details && import.meta.env.DEV) {
      console.error('Upload error details:', details);
    }
    throw new Error(message);
  }

  return await response.json();
};

// Get review queue (Admin only)
export const getReviewQueue = async (): Promise<ReviewQueueResponse> => {
  const token = getToken();
  const headers: Record<string, string> = {};

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${TURTLE_API_BASE_URL}/review-queue`, {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to load review queue');
  }

  return await response.json();
};

// Add additional images (microhabitat, condition, carapace, plastron, additional, other) to a review packet (Admin only)
export const uploadReviewPacketAdditionalImages = async (
  requestId: string,
  files: Array<{
    type: 'microhabitat' | 'condition' | 'carapace' | 'plastron' | 'additional' | 'other';
    file: File;
    labels?: string[];
  }>,
): Promise<{ success: boolean; message?: string }> => {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const formData = new FormData();
  files.forEach((f, i) => {
    formData.append(`file_${i}`, f.file);
    formData.append(`type_${i}`, f.type);
    if (f.labels?.length) {
      formData.append(`labels_${i}`, f.labels.join(', '));
    }
  });
  const response = await fetch(
    `${TURTLE_API_BASE_URL}/review-queue/${encodeURIComponent(requestId)}/additional-images`,
    { method: 'POST', headers, body: formData },
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error(err.error || 'Failed to add images');
  }
  return await response.json();
};

// Get single review packet (Admin only)
export const getReviewPacket = async (
  requestId: string,
): Promise<{ success: boolean; item: ReviewQueueItem }> => {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const response = await fetch(
    `${TURTLE_API_BASE_URL}/review-queue/${encodeURIComponent(requestId)}`,
    { method: 'GET', headers },
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Failed to load packet' }));
    throw new Error(err.error || 'Failed to load packet');
  }
  return await response.json();
};

// Remove one additional image from a review packet (Admin only)
export const removeReviewPacketAdditionalImage = async (
  requestId: string,
  filename: string,
): Promise<void> => {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const response = await fetch(
    `${TURTLE_API_BASE_URL}/review-queue/${encodeURIComponent(requestId)}/additional-images`,
    { method: 'DELETE', headers, body: JSON.stringify({ filename }) },
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Failed to remove image' }));
    throw new Error(err.error || 'Failed to remove image');
  }
};

// Approve review item (Admin only)
export const approveReview = async (
  requestId: string,
  data: ApproveReviewRequest,
): Promise<ApproveReviewResponse> => {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(
    `${TURTLE_API_BASE_URL}/review/${requestId}/approve`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
    },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to approve review');
  }

  return await response.json();
};

/** Cross-check a review packet against a different photo_type cache (diagnostic, does not modify packet). */
export const crossCheckReviewPacket = async (
  requestId: string,
  photoType: PhotoType,
  imagePath?: string,
): Promise<{
  success: boolean;
  photo_type: string;
  matches: Array<{ turtle_id: string; location: string; confidence: number; score: number; image_path: string }>;
  elapsed: number;
}> => {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const body: Record<string, string> = { photo_type: photoType };
  if (imagePath) body.image_path = imagePath;
  const response = await fetch(
    `${TURTLE_API_BASE_URL}/review-queue/${encodeURIComponent(requestId)}/cross-check`,
    { method: 'POST', headers, body: JSON.stringify(body) },
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Cross-check failed' }));
    throw new Error(err.error || 'Failed to cross-check');
  }
  return await response.json();
};

// Classify a review packet as plastron or carapace, triggering AI matching (Admin only)
export const classifyReviewPacket = async (
  requestId: string,
  photoType: PhotoType,
): Promise<{ success: boolean; item: ReviewQueueItem; matches_found: number }> => {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const response = await fetch(
    `${TURTLE_API_BASE_URL}/review-queue/${encodeURIComponent(requestId)}/classify`,
    { method: 'POST', headers, body: JSON.stringify({ photo_type: photoType }) },
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Classification failed' }));
    throw new Error(err.error || 'Failed to classify review packet');
  }
  return await response.json();
};

// Delete review queue item (Admin only)
export const deleteReviewItem = async (
  requestId: string,
): Promise<{ success: boolean; message: string }> => {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const response = await fetch(
    `${TURTLE_API_BASE_URL}/review/${encodeURIComponent(requestId)}`,
    {
      method: 'DELETE',
      headers,
    },
  );
  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: 'Failed to delete' }));
    throw new Error(error.error || 'Failed to delete review item');
  }
  return await response.json();
};

// Get turtles with flag/find metadata (Admin only – for release page)
export const getTurtlesWithFlags = async (): Promise<{
  success: boolean;
  items: Array<{
    turtle_id: string;
    location: string;
    path: string;
    find_metadata: FindMetadata & Record<string, unknown>;
  }>;
}> => {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const response = await fetch(`${TURTLE_API_BASE_URL}/flags`, { method: 'GET', headers });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Failed to load flags' }));
    throw new Error(err.error || 'Failed to load turtles with flags');
  }
  return await response.json();
};

/** Mark turtle as released back to nature (clear digital flag, set released_at). Admin only. */
export const clearReleaseFlag = async (
  turtleId: string,
  location?: string | null,
): Promise<void> => {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const response = await fetch(`${TURTLE_API_BASE_URL}/flags/release`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ turtle_id: turtleId, location: location || undefined }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Failed to clear release flag' }));
    throw new Error(err.error || 'Failed to clear release flag');
  }
};

// Get image URL helper
export const getImageUrl = (imagePath: string): string => {
  if (imagePath.startsWith('http')) {
    return imagePath;
  }
  const encodedPath = encodeURIComponent(imagePath);
  return `${TURTLE_API_BASE_URL.replace('/api', '')}/api/images?path=${encodedPath}`;
};

/** Download URL — triggers Content-Disposition: attachment server-side. */
export const getTurtleImageDownloadUrl = (imagePath: string): string => {
  if (imagePath.startsWith('http')) {
    return imagePath;
  }
  const encodedPath = encodeURIComponent(imagePath);
  return `${TURTLE_API_BASE_URL.replace('/api', '')}/api/images?path=${encodedPath}&download=1`;
};

// Turtle images (Admin only) – primary plastron/carapace, additional, loose, history
export interface TurtleImageAdditional {
  path: string;
  type: string;
  /** Free-form tags (e.g. burned, injury) for filtering in Sheets browser */
  labels?: string[];
  /** Display-preferred date: EXIF first, upload fallback. */
  timestamp?: string | null;
  /** When the photo was originally taken (camera EXIF DateTimeOriginal). */
  exif_date?: string | null;
  /** When the system stored the file (from manifest, filename stamp, or folder name). */
  upload_date?: string | null;
  uploaded_by?: string | null;
}

export type TurtleLooseSource =
  | 'plastron_old_ref'
  | 'plastron_other'
  | 'carapace_old_ref'
  | 'carapace_other'
  | 'loose_legacy';

export interface TurtleLooseImage {
  path: string;
  source: TurtleLooseSource;
  /** Display-preferred date: EXIF first, upload fallback. */
  timestamp?: string | null;
  exif_date?: string | null;
  upload_date?: string | null;
}

export interface TurtlePrimaryInfo {
  path: string;
  /** Display-preferred date: EXIF first, upload fallback. */
  timestamp?: string | null;
  exif_date?: string | null;
  upload_date?: string | null;
}

export type TurtleDeletedCategory =
  | 'reference'
  | 'plastron_old_ref'
  | 'plastron_other'
  | 'carapace_old_ref'
  | 'carapace_other'
  | 'additional'
  | 'loose_legacy'
  | 'unknown';

export interface TurtleDeletedImage {
  /** Absolute path of the file inside {turtle_dir}/Deleted/... */
  path: string;
  /** Absolute path where restore would place this file. */
  original_path: string;
  /** Turtle-dir relative path starting with "Deleted/". Used by the restore endpoint. */
  deleted_rel_path: string;
  category: TurtleDeletedCategory;
  timestamp?: string | null;
  exif_date?: string | null;
  upload_date?: string | null;
}

export interface TurtleAdditionalLabelSearchMatch {
  turtle_id: string;
  sheet_name: string;
  path: string;
  filename: string;
  type: string;
  labels: string[];
  timestamp?: string | null;
}

export interface TurtleImagesResponse {
  primary: string | null;
  primary_carapace: string | null;
  /** Active plastron reference with its capture/upload dates. */
  primary_info?: TurtlePrimaryInfo | null;
  /** Active carapace reference with its capture/upload dates. */
  primary_carapace_info?: TurtlePrimaryInfo | null;
  additional: TurtleImageAdditional[];
  loose: TurtleLooseImage[];
  history_dates: string[];
  /** Soft-deleted images (in {turtle_dir}/Deleted/). */
  deleted?: TurtleDeletedImage[];
}

export const getTurtleImages = async (
  turtleId: string,
  sheetName?: string | null,
): Promise<TurtleImagesResponse> => {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const params = new URLSearchParams({ turtle_id: turtleId });
  if (sheetName) params.set('sheet_name', sheetName);
  const response = await fetch(
    `${TURTLE_API_BASE_URL}/turtles/images?${params.toString()}`,
    { method: 'GET', headers },
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Failed to load images' }));
    throw new Error(err.error || 'Failed to load turtle images');
  }
  return await response.json();
};

/** Find additional images whose labels match q (substring, case-insensitive). Admin only. */
export const searchTurtleImagesByLabel = async (
  q: string,
): Promise<{ matches: TurtleAdditionalLabelSearchMatch[] }> => {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const params = new URLSearchParams({ q: q.trim() });
  const response = await fetch(
    `${TURTLE_API_BASE_URL}/turtles/images/search-labels?${params.toString()}`,
    { method: 'GET', headers },
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Search failed' }));
    throw new Error(err.error || 'Search failed');
  }
  return await response.json();
};

/** Update labels on one additional image (manifest). Admin only. */
export const updateTurtleAdditionalImageLabels = async (
  turtleId: string,
  filename: string,
  labels: string[],
  sheetName?: string | null,
): Promise<void> => {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const body: Record<string, unknown> = {
    turtle_id: turtleId,
    filename,
    labels,
  };
  if (sheetName) body.sheet_name = sheetName;
  const response = await fetch(`${TURTLE_API_BASE_URL}/turtles/images/additional-labels`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Failed to update labels' }));
    throw new Error(err.error || 'Failed to update labels');
  }
};

/** Batch get primary (plastron) image paths for multiple turtles (Admin only). */
export const getTurtlePrimariesBatch = async (
  turtles: Array<{ turtle_id: string; sheet_name?: string | null }>,
): Promise<{ images: Array<{ turtle_id: string; sheet_name: string | null; primary: string | null }> }> => {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const response = await fetch(`${TURTLE_API_BASE_URL}/turtles/images/primaries`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ turtles }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Failed to load primaries' }));
    throw new Error(err.error || 'Failed to load primaries');
  }
  return await response.json();
};

/** Replace a turtle's plastron or carapace reference image atomically (Admin only). */
export const uploadTurtleReplaceReference = async (
  turtleId: string,
  file: File,
  photoType: 'plastron' | 'carapace',
  sheetName?: string | null,
): Promise<{ success: boolean; message?: string }> => {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const formData = new FormData();
  formData.append('turtle_id', turtleId);
  formData.append('photo_type', photoType);
  formData.append('file', file);
  if (sheetName) formData.append('sheet_name', sheetName);
  const response = await fetch(`${TURTLE_API_BASE_URL}/turtles/replace-reference`, {
    method: 'POST',
    headers,
    body: formData,
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Failed to replace reference' }));
    throw new Error(err.error || 'Failed to replace reference');
  }
  return await response.json();
};

/** Set or replace ref_data identifier plastron (.pt + master image). Admin only. */
export const uploadTurtleIdentifierPlastron = async (
  turtleId: string,
  file: File,
  sheetName: string | null | undefined,
  mode: 'set_if_missing' | 'replace',
): Promise<{ success: boolean; message?: string }> => {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const formData = new FormData();
  formData.append('turtle_id', turtleId);
  formData.append('file', file);
  formData.append('mode', mode);
  if (sheetName) formData.append('sheet_name', sheetName);
  const response = await fetch(`${TURTLE_API_BASE_URL}/turtles/images/identifier-plastron`, {
    method: 'POST',
    headers,
    body: formData,
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Failed to update identifier plastron' }));
    throw new Error(err.error || 'Failed to update identifier plastron');
  }
  return await response.json();
};

/** Add microhabitat/condition/carapace/plastron (additional) images to a turtle folder (Admin only). */
export const uploadTurtleAdditionalImages = async (
  turtleId: string,
  files: Array<{
    type: 'microhabitat' | 'condition' | 'carapace' | 'plastron' | 'additional' | 'other';
    file: File;
    /** Applied to this file only (comma-separated sent as labels_i) */
    labels?: string[];
  }>,
  sheetName?: string | null,
): Promise<{ success: boolean; message?: string }> => {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const formData = new FormData();
  formData.append('turtle_id', turtleId);
  if (sheetName) formData.append('sheet_name', sheetName);
  files.forEach((f, i) => {
    formData.append(`file_${i}`, f.file);
    formData.append(`type_${i}`, f.type);
    if (f.labels?.length) {
      formData.append(`labels_${i}`, f.labels.join(', '));
    }
  });
  const response = await fetch(`${TURTLE_API_BASE_URL}/turtles/images/additional`, {
    method: 'POST',
    headers,
    body: formData,
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Failed to add images' }));
    throw new Error(err.error || 'Failed to add images');
  }
  return await response.json();
};

/** Delete one additional image from a turtle's folder (Admin only). */
export const deleteTurtleAdditionalImage = async (
  turtleId: string,
  filename: string,
  sheetName?: string | null,
): Promise<void> => {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const params = new URLSearchParams({ turtle_id: turtleId, filename });
  if (sheetName) params.set('sheet_name', sheetName);
  const response = await fetch(
    `${TURTLE_API_BASE_URL}/turtles/images/additional?${params.toString()}`,
    { method: 'DELETE', headers },
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Failed to delete image' }));
    throw new Error(err.error || 'Failed to delete image');
  }
};

// --------------------------------------------------------------------------
// Soft-delete / restore (Admin only)
// --------------------------------------------------------------------------

export interface DeleteTurtleImageResponse {
  success: boolean;
  /** Absolute path of the file in Deleted/. */
  moved_to: string;
  /** 'plastron' | 'carapace' when the deleted file was the active ref, else null. */
  was_reference: 'plastron' | 'carapace' | null;
  /** True if an Old Reference was promoted back to active automatically. */
  reverted: boolean;
  /** Absolute path of the newly-promoted active reference, if reverted. */
  new_reference_path: string | null;
  /** Present when promotion succeeded on move but .pt regeneration failed. */
  error_promoting?: string;
}

export const deleteTurtleImage = async (
  turtleId: string,
  imagePath: string,
  sheetName?: string | null,
): Promise<DeleteTurtleImageResponse> => {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const response = await fetch(`${TURTLE_API_BASE_URL}/turtles/image`, {
    method: 'DELETE',
    headers,
    body: JSON.stringify({
      turtle_id: turtleId,
      path: imagePath,
      sheet_name: sheetName ?? null,
    }),
  });
  const body = await response.json().catch(() => ({ error: 'Failed to delete image' }));
  if (!response.ok) {
    throw new Error(body.error || 'Failed to delete image');
  }
  return body as DeleteTurtleImageResponse;
};

export interface RestoreTurtleImageResponse {
  success: boolean;
  /** Absolute path the image was restored to. */
  restored_to: string;
  /** 'plastron' | 'carapace' when the restore targets an active-ref slot, else null. */
  is_reference: 'plastron' | 'carapace' | null;
  /** Present when move succeeded but .pt extraction didn't. */
  warning?: string;
}

export class RestoreCollisionError extends Error {
  collision = true;
  constructor(message: string) {
    super(message);
    this.name = 'RestoreCollisionError';
  }
}

export const restoreTurtleImage = async (
  turtleId: string,
  deletedPath: string,
  sheetName?: string | null,
): Promise<RestoreTurtleImageResponse> => {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const response = await fetch(`${TURTLE_API_BASE_URL}/turtles/restore-image`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      turtle_id: turtleId,
      path: deletedPath,
      sheet_name: sheetName ?? null,
    }),
  });
  const body = await response.json().catch(() => ({ error: 'Failed to restore image' }));
  if (!response.ok) {
    if (response.status === 409 || body.collision) {
      throw new RestoreCollisionError(body.error || 'A file already exists at the restore location.');
    }
    throw new Error(body.error || 'Failed to restore image');
  }
  return body as RestoreTurtleImageResponse;
};
