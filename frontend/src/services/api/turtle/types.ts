import type { TurtleSheetsData } from '../sheets';

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

/** One row from the read-only carapace quick check (mirrors cross-check shape). */
export interface QuickCheckMatch {
  turtle_id: string;
  location: string;
  confidence: number;
  score: number;
  /** May still be a `.pt` path when no sibling image exists — treat as "no image". */
  image_path: string;
}

export interface QuickCheckResponse {
  success: boolean;
  photo_type: 'carapace';
  matches: QuickCheckMatch[];
  elapsed: number;
}

/** Location hint from community (never stored in sheets, queue/display only) */
export interface LocationHint {
  latitude: number;
  longitude: number;
  source: 'gps' | 'manual';
}

export type AdditionalImageType =
  | 'microhabitat'
  | 'condition'
  | 'carapace'
  | 'plastron'
  | 'anterior'
  | 'posterior'
  | 'left-side'
  | 'right-side'
  | 'people'
  | 'injury'
  | 'other';

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
  type: AdditionalImageType;
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

/**
 * Optional knobs for ``getImageUrl``:
 * - ``version`` — cache-bust suffix appended as ``&v=<version>``. Active
 *   reference paths are stable across replacements (the new file lands at
 *   the same on-disk location), so without a version the browser keeps
 *   serving the previously-cached bytes. Pass primary_info.upload_ts /
 *   primary_ts wherever you render an active reference; non-version-aware
 *   callers (e.g. archived photos under unique paths) can omit it.
 * - ``maxDim`` — server-side downscaled JPEG preview (longest edge in
 *   pixels, clamped 32–2048). Returns the original when it's already
 *   smaller than ``maxDim``.
 */
export interface GetImageUrlOptions {
  version?: string | number | null;
  maxDim?: number;
}

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
  /** Epoch ms — finer-grained than upload_date; used as sort tiebreaker. */
  upload_ts?: number | null;
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
  /** Free-form tags from the per-directory manifest (e.g. burned, scarred). */
  labels?: string[];
  /** Display-preferred date: EXIF first, upload fallback. */
  timestamp?: string | null;
  exif_date?: string | null;
  upload_date?: string | null;
  /** Epoch ms — finer-grained than upload_date; used as sort tiebreaker. */
  upload_ts?: number | null;
}

export interface TurtlePrimaryInfo {
  path: string;
  /** Free-form tags from the per-directory manifest (e.g. healthy, juvenile). */
  labels?: string[];
  /** Display-preferred date: EXIF first, upload fallback. */
  timestamp?: string | null;
  exif_date?: string | null;
  upload_date?: string | null;
  /** Epoch ms — used as cache-bust on the image URL since active-reference
   *  paths stay identical across replacements. */
  upload_ts?: number | null;
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
  /** Free-form tags from the per-directory manifest. */
  labels?: string[];
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
