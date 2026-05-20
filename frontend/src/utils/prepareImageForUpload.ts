import {
  MAX_RAW_FILE_BYTES,
  MAX_UPLOAD_BYTES,
  UPLOAD_JPEG_QUALITY,
  UPLOAD_MAX_DIMENSION,
  UPLOAD_SKIP_COMPRESS_BELOW_BYTES,
} from './uploadConstants';

const COMPRESSIBLE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
]);
const COMPRESSIBLE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);

function outputName(originalName: string): string {
  const base = originalName.replace(/\.[^.]+$/, '') || 'upload';
  return `${base}.jpg`;
}

function canDecodeInBrowser(file: File): boolean {
  const typeOk = file.type && COMPRESSIBLE_TYPES.has(file.type);
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return typeOk || COMPRESSIBLE_EXT.has(ext);
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('decode_failed'));
    };
    img.src = url;
  });
}

function canvasToJpegFile(
  canvas: HTMLCanvasElement,
  name: string,
  quality: number,
): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('encode_failed'));
          return;
        }
        resolve(new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() }));
      },
      'image/jpeg',
      quality,
    );
  });
}

/**
 * Resize and re-encode photos before upload so smartphone originals (often 5–15 MB)
 * fit server limits without raising the attack surface.
 * HEIC/HEIF is passed through when the browser cannot decode it (server normalizes).
 */
export async function prepareImageForUpload(file: File): Promise<File> {
  if (file.size > MAX_RAW_FILE_BYTES) {
    throw new Error(
      `File is too large (${(MAX_RAW_FILE_BYTES / 1024 / 1024).toFixed(0)} MB max from device).`,
    );
  }

  if (!canDecodeInBrowser(file)) {
    if (file.size <= MAX_UPLOAD_BYTES) {
      return file;
    }
    throw new Error(
      'This image format could not be optimized in the browser. Save as JPEG or PNG and try again.',
    );
  }

  if (file.size <= UPLOAD_SKIP_COMPRESS_BELOW_BYTES) {
    try {
      const img = await loadImageFromFile(file);
      if (Math.max(img.naturalWidth, img.naturalHeight) <= UPLOAD_MAX_DIMENSION) {
        return file;
      }
    } catch {
      return file;
    }
  }

  const img = await loadImageFromFile(file);
  const srcW = img.naturalWidth;
  const srcH = img.naturalHeight;
  if (!srcW || !srcH) {
    throw new Error('Could not read image dimensions.');
  }

  const scale = Math.min(1, UPLOAD_MAX_DIMENSION / Math.max(srcW, srcH));
  const dstW = Math.max(1, Math.round(srcW * scale));
  const dstH = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = dstW;
  canvas.height = dstH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not prepare image for upload.');
  }
  ctx.drawImage(img, 0, 0, dstW, dstH);

  let out = await canvasToJpegFile(canvas, outputName(file.name), UPLOAD_JPEG_QUALITY);

  if (out.size > MAX_UPLOAD_BYTES) {
    out = await canvasToJpegFile(canvas, outputName(file.name), 0.72);
  }
  if (out.size > MAX_UPLOAD_BYTES) {
    out = await canvasToJpegFile(canvas, outputName(file.name), 0.58);
  }
  if (out.size > MAX_UPLOAD_BYTES) {
    throw new Error('Image is still too large after optimization. Try a smaller photo.');
  }

  return out;
}

export async function prepareImagesForUpload(files: File[]): Promise<File[]> {
  return Promise.all(files.map((f) => prepareImageForUpload(f)));
}
