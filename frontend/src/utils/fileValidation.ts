/**
 * File validation for photo uploads (size, type).
 * Used after client-side optimization and before sending to the API.
 */

import { MAX_UPLOAD_BYTES } from './uploadConstants';

const MAX_SIZE = MAX_UPLOAD_BYTES;
const VALID_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
];
// Chrome/Firefox often leave file.type empty for HEIC since they can't read it;
// fall back to the extension so iPhone uploads are accepted on any browser.
const VALID_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif'];

export function validateFile(file: File): { isValid: boolean; error?: string } {
  if (file.size > MAX_SIZE) {
    return {
      isValid: false,
      error: `File is too large. Maximum: ${(MAX_SIZE / 1024 / 1024).toFixed(0)}MB`,
    };
  }
  const typeOk = VALID_TYPES.includes(file.type);
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const extOk = VALID_EXTENSIONS.includes(ext);
  if (!typeOk && !extOk) {
    return {
      isValid: false,
      error: 'Invalid file type. Allowed: JPEG, PNG, GIF, WEBP, HEIC',
    };
  }
  return { isValid: true };
}

/**
 * Simple hash for duplicate detection (filename + size + type).
 * Used when grouping photos by "same file".
 */
export function generateFileHash(
  file: File | { name: string; size: number; type: string }
): string {
  return `${file.name}_${file.size}_${file.type}`;
}
