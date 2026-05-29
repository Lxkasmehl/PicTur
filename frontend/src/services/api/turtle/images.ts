import { TURTLE_API_BASE_URL } from '../config';
import { prepareImageForUpload } from '../../../utils/prepareImageForUpload';
import { authHeaders, throwJsonError, throwUploadHttpError } from './http';
import type {
  AdditionalImageType,
  DeleteTurtleImageResponse,
  GetImageUrlOptions,
  RestoreTurtleImageResponse,
  TurtleAdditionalLabelSearchMatch,
  TurtleImagesResponse,
} from './types';
import { RestoreCollisionError } from './types';

export const getImageUrl = (
  imagePath: string,
  versionOrOptions?: string | number | null | GetImageUrlOptions,
): string => {
  if (imagePath.startsWith('http')) {
    return imagePath;
  }
  const opts: GetImageUrlOptions =
    versionOrOptions == null
      ? {}
      : typeof versionOrOptions === 'object'
        ? versionOrOptions
        : { version: versionOrOptions };
  const encodedPath = encodeURIComponent(imagePath);
  const params: string[] = [`path=${encodedPath}`];
  if (opts.maxDim != null && Number.isFinite(opts.maxDim) && opts.maxDim > 0) {
    const dim = Math.min(2048, Math.max(32, Math.round(opts.maxDim)));
    params.push(`max_dim=${dim}`);
  }
  if (opts.version != null && opts.version !== '') {
    params.push(`v=${encodeURIComponent(String(opts.version))}`);
  }
  return `${TURTLE_API_BASE_URL.replace('/api', '')}/api/images?${params.join('&')}`;
};

export const getTurtleImageDownloadUrl = (imagePath: string): string => {
  if (imagePath.startsWith('http')) {
    return imagePath;
  }
  const encodedPath = encodeURIComponent(imagePath);
  return `${TURTLE_API_BASE_URL.replace('/api', '')}/api/images?path=${encodedPath}&download=1`;
};

export const getTurtleImages = async (
  turtleId: string,
  sheetName?: string | null,
  primaryId?: string | null,
): Promise<TurtleImagesResponse> => {
  const params = new URLSearchParams({ turtle_id: turtleId });
  if (sheetName) params.set('sheet_name', sheetName);
  if (primaryId && primaryId !== turtleId) params.set('primary_id', primaryId);
  const response = await fetch(
    `${TURTLE_API_BASE_URL}/turtles/images?${params.toString()}`,
    { method: 'GET', headers: authHeaders() },
  );
  if (!response.ok) {
    await throwJsonError(response, 'Failed to load turtle images');
  }
  return await response.json();
};

export const searchTurtleImagesByLabel = async (
  q: string,
  photoType?: string | null,
): Promise<{ matches: TurtleAdditionalLabelSearchMatch[] }> => {
  const params = new URLSearchParams();
  const trimmed = q.trim();
  if (trimmed) params.set('q', trimmed);
  if (photoType?.trim()) params.set('type', photoType.trim());
  const response = await fetch(
    `${TURTLE_API_BASE_URL}/turtles/images/search-labels?${params.toString()}`,
    { method: 'GET', headers: authHeaders() },
  );
  if (!response.ok) {
    await throwJsonError(response, 'Search failed');
  }
  return await response.json();
};

export const updateTurtleAdditionalImageLabels = async (
  turtleId: string,
  filename: string,
  labels: string[],
  sheetName?: string | null,
): Promise<void> => {
  const body: Record<string, unknown> = {
    turtle_id: turtleId,
    filename,
    labels,
  };
  if (sheetName) body.sheet_name = sheetName;
  const response = await fetch(`${TURTLE_API_BASE_URL}/turtles/images/additional-labels`, {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    await throwJsonError(response, 'Failed to update labels');
  }
};

export const setTurtleImageLabels = async (
  turtleId: string,
  imagePath: string,
  labels: string[],
  sheetName?: string | null,
  primaryId?: string | null,
): Promise<{ labels: string[] }> => {
  const body: Record<string, unknown> = {
    turtle_id: turtleId,
    path: imagePath,
    labels,
  };
  if (sheetName) body.sheet_name = sheetName;
  if (primaryId) body.primary_id = primaryId;
  const response = await fetch(`${TURTLE_API_BASE_URL}/turtles/images/labels`, {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    await throwJsonError(response, 'Failed to update labels');
  }
  return await response.json();
};

export const getTurtlePrimariesBatch = async (
  turtles: Array<{ turtle_id: string; sheet_name?: string | null; primary_id?: string | null }>,
): Promise<{
  images: Array<{
    turtle_id: string;
    sheet_name: string | null;
    primary: string | null;
    primary_ts?: number | null;
    has_carapace?: boolean;
    folder_status?: 'has_images' | 'empty_folder' | 'no_folder';
  }>;
}> => {
  const response = await fetch(`${TURTLE_API_BASE_URL}/turtles/images/primaries`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ turtles }),
  });
  if (!response.ok) {
    await throwJsonError(response, 'Failed to load primaries');
  }
  return await response.json();
};

export const uploadTurtleReplaceReference = async (
  turtleId: string,
  file: File,
  photoType: 'plastron' | 'carapace',
  sheetName?: string | null,
  primaryId?: string | null,
  opts?: { createIfMissing?: boolean; bioId?: string | null },
): Promise<{ success: boolean; message?: string }> => {
  const prepared = await prepareImageForUpload(file);
  const formData = new FormData();
  formData.append('turtle_id', turtleId);
  formData.append('photo_type', photoType);
  formData.append('file', prepared);
  if (sheetName) formData.append('sheet_name', sheetName);
  if (primaryId) formData.append('primary_id', primaryId);
  if (opts?.createIfMissing) formData.append('create_if_missing', 'true');
  if (opts?.bioId) formData.append('bio_id', opts.bioId);
  const response = await fetch(`${TURTLE_API_BASE_URL}/turtles/replace-reference`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });
  if (!response.ok) {
    await throwUploadHttpError(response, 'Failed to replace reference');
  }
  return await response.json();
};

export const uploadTurtleIdentifierPlastron = async (
  turtleId: string,
  file: File,
  sheetName: string | null | undefined,
  mode: 'set_if_missing' | 'replace',
  primaryId?: string | null,
): Promise<{ success: boolean; message?: string }> => {
  const prepared = await prepareImageForUpload(file);
  const formData = new FormData();
  formData.append('turtle_id', turtleId);
  formData.append('file', prepared);
  formData.append('mode', mode);
  if (sheetName) formData.append('sheet_name', sheetName);
  if (primaryId) formData.append('primary_id', primaryId);
  const response = await fetch(`${TURTLE_API_BASE_URL}/turtles/images/identifier-plastron`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });
  if (!response.ok) {
    await throwUploadHttpError(response, 'Failed to update identifier plastron');
  }
  return await response.json();
};

export const uploadTurtleAdditionalImages = async (
  turtleId: string,
  files: Array<{
    type: AdditionalImageType;
    file: File;
    labels?: string[];
  }>,
  sheetName?: string | null,
  primaryId?: string | null,
  opts?: { bioId?: string | null },
): Promise<{ success: boolean; message?: string }> => {
  const prepared = await Promise.all(
    files.map(async (f) => ({ ...f, file: await prepareImageForUpload(f.file) })),
  );
  const formData = new FormData();
  formData.append('turtle_id', turtleId);
  if (sheetName) formData.append('sheet_name', sheetName);
  if (primaryId) formData.append('primary_id', primaryId);
  if (opts?.bioId) formData.append('bio_id', opts.bioId);
  prepared.forEach((f, i) => {
    formData.append(`file_${i}`, f.file);
    formData.append(`type_${i}`, f.type);
    if (f.labels?.length) {
      formData.append(`labels_${i}`, f.labels.join(', '));
    }
  });
  const response = await fetch(`${TURTLE_API_BASE_URL}/turtles/images/additional`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });
  if (!response.ok) {
    await throwUploadHttpError(response, 'Failed to add images');
  }
  return await response.json();
};

export const deleteTurtleAdditionalImage = async (
  turtleId: string,
  filename: string,
  sheetName?: string | null,
): Promise<void> => {
  const params = new URLSearchParams({ turtle_id: turtleId, filename });
  if (sheetName) params.set('sheet_name', sheetName);
  const response = await fetch(
    `${TURTLE_API_BASE_URL}/turtles/images/additional?${params.toString()}`,
    { method: 'DELETE', headers: authHeaders() },
  );
  if (!response.ok) {
    await throwJsonError(response, 'Failed to delete image');
  }
};

export const deleteTurtleImage = async (
  turtleId: string,
  imagePath: string,
  sheetName?: string | null,
): Promise<DeleteTurtleImageResponse> => {
  const response = await fetch(`${TURTLE_API_BASE_URL}/turtles/image`, {
    method: 'DELETE',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
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

export const restoreTurtleImage = async (
  turtleId: string,
  deletedPath: string,
  sheetName?: string | null,
): Promise<RestoreTurtleImageResponse> => {
  const response = await fetch(`${TURTLE_API_BASE_URL}/turtles/restore-image`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
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
