import { removeToken, TURTLE_API_BASE_URL } from '../config';
import { prepareImageForUpload } from '../../../utils/prepareImageForUpload';
import { parseUploadApiErrorBody } from '../../../utils/uploadErrorMessages';
import { authHeaders } from './http';
import type {
  LocationHint,
  QuickCheckResponse,
  UploadExtraFile,
  UploadFlagOptions,
  UploadPhotoResponse,
} from './types';

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
  const preparedMain = await prepareImageForUpload(file);
  const preparedExtras = extraFiles?.length
    ? await Promise.all(
        extraFiles.map(async (ef) => ({
          ...ef,
          file: await prepareImageForUpload(ef.file),
        })),
      )
    : undefined;

  const formData = new FormData();
  formData.append('file', preparedMain);

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
  if (preparedExtras?.length) {
    preparedExtras.forEach((ef, i) => {
      formData.append(`extra_${ef.type}_${i}`, ef.file);
      if (ef.labels?.length) {
        formData.append(`extra_labels_${i}`, ef.labels.join(', '));
      }
    });
  }

  const response = await fetch(`${TURTLE_API_BASE_URL}/upload`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });

  if (!response.ok) {
    if (response.status === 401) {
      removeToken();
      throw new Error('Authentication failed. Please try again.');
    }
    const body = await response.json().catch(() => ({}));
    const { message, code } = parseUploadApiErrorBody(body);
    const details = (body as { details?: string }).details;
    if (details && import.meta.env.DEV) {
      console.error('Upload error details:', details);
    }
    if (import.meta.env.DEV && code) {
      console.error('Upload error code:', code);
    }
    throw new Error(message);
  }

  return await response.json();
};

/**
 * Read-only carapace quick check (admin only). Matches the photo against the
 * carapace pool and returns ranked candidates; the backend persists nothing.
 */
export const quickCheckCarapaceMatch = async (
  file: File,
  /** Sheet/location scope; '' = test against all locations */
  matchSheet: string,
): Promise<QuickCheckResponse> => {
  const prepared = await prepareImageForUpload(file);

  const formData = new FormData();
  formData.append('file', prepared);
  formData.append('match_sheet', matchSheet);

  const response = await fetch(`${TURTLE_API_BASE_URL}/match/quick-check`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });

  if (!response.ok) {
    if (response.status === 401) {
      removeToken();
      throw new Error('Authentication failed. Please try again.');
    }
    const body = await response.json().catch(() => ({}));
    const { message } = parseUploadApiErrorBody(body);
    throw new Error(message);
  }

  return await response.json();
};
