/** Map upload error codes/messages to user-facing copy. */

const CODE_MESSAGES: Record<string, string> = {
  decode_failed:
    'This photo could not be read. It may be corrupted or from a Word/email paste. Re-save as JPEG or PNG, or upload a screenshot.',
  invalid_image:
    'This file does not look like a valid photo. Re-save as JPEG or PNG, or take a screenshot and upload that.',
  invalid_extension:
    'Invalid file type. Allowed: JPEG, PNG, GIF, WEBP, HEIC.',
  file_too_large:
    'File is too large after optimization (max 8 MB). Try a smaller photo or screenshot.',
  rate_limited:
    'Too many uploads in a short time. Please wait a few minutes and try again.',
  encode_failed:
    'Could not prepare this photo for upload. Re-save as JPEG or PNG, or take a screenshot.',
  no_valid_files: 'No valid image files were provided.',
  processing_failed: 'Upload processing failed on the server. Please try again.',
};

export interface ParsedUploadApiError {
  message: string;
  code?: string;
}

export function userFacingUploadError(code?: string, fallback?: string): string {
  if (code && CODE_MESSAGES[code]) {
    return CODE_MESSAGES[code];
  }
  if (fallback && CODE_MESSAGES[fallback]) {
    return CODE_MESSAGES[fallback];
  }
  if (fallback) {
    return fallback;
  }
  return 'Could not use this photo. Re-save as JPEG or PNG, or take a screenshot.';
}

export function parseUploadApiErrorBody(
  body: unknown,
  endpointFallback?: string,
): ParsedUploadApiError {
  if (!body || typeof body !== 'object') {
    return { message: endpointFallback ?? userFacingUploadError() };
  }
  const record = body as Record<string, unknown>;
  const code = typeof record.code === 'string' ? record.code : undefined;
  const rawError = typeof record.error === 'string' ? record.error : undefined;
  if (!code && !rawError) {
    return { message: endpointFallback ?? userFacingUploadError() };
  }
  return {
    code,
    message: userFacingUploadError(code, rawError),
  };
}

/** react-dropzone rejection codes → message */
export function dropzoneRejectionMessage(
  code: string | undefined,
  opts?: { maxRawMb?: number },
): string {
  switch (code) {
    case 'file-too-large':
      if (opts?.maxRawMb) {
        return `File is too large. Maximum from device: ${opts.maxRawMb} MB`;
      }
      return CODE_MESSAGES.file_too_large;
    case 'file-invalid-type':
      return CODE_MESSAGES.invalid_extension;
    default:
      return userFacingUploadError(undefined, 'File could not be accepted');
  }
}
