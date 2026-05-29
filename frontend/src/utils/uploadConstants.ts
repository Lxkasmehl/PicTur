/** Max bytes accepted from the device before client-side optimization. */
export const MAX_RAW_FILE_BYTES = 25 * 1024 * 1024;

/** Max bytes after optimization (must stay ≤ backend MAX_FILE_SIZE). */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** Longest edge (px) for photos sent to the API. */
export const UPLOAD_MAX_DIMENSION = 2048;

/** JPEG quality for upload optimization (0–1). */
export const UPLOAD_JPEG_QUALITY = 0.82;

/** Skip re-encoding when already small and likely within dimension budget. */
export const UPLOAD_SKIP_COMPRESS_BELOW_BYTES = 400 * 1024;
