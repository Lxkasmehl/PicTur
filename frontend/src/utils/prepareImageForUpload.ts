import piexif, { type ExifDict } from 'piexifjs';
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

/** Files already optimized by prepareImageForUpload (e.g. via acceptUploadFile). */
const preparedUploadFiles = new WeakSet<File>();

export function isUploadFilePrepared(file: File): boolean {
  return preparedUploadFiles.has(file);
}

function markUploadFilePrepared(file: File): void {
  preparedUploadFiles.add(file);
}

function outputName(originalName: string): string {
  const base = originalName.replace(/\.[^.]+$/, '') || 'upload';
  return `${base}.jpg`;
}

function canDecodeInBrowser(file: File): boolean {
  const typeOk = file.type && COMPRESSIBLE_TYPES.has(file.type);
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return typeOk || COMPRESSIBLE_EXT.has(ext);
}

function isJpegFile(file: File): boolean {
  const type = file.type.toLowerCase();
  if (type === 'image/jpeg' || type === 'image/jpg') return true;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return ext === 'jpg' || ext === 'jpeg';
}

function arrayBufferToBinaryString(buf: ArrayBuffer): string {
  const u8 = new Uint8Array(buf);
  const chunk = 0x8000;
  let out = '';
  for (let i = 0; i < u8.length; i += chunk) {
    out += String.fromCharCode(...u8.subarray(i, i + chunk));
  }
  return out;
}

function binaryStringToArrayBuffer(binary: string): ArrayBuffer {
  const len = binary.length;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = binary.charCodeAt(i);
  return out.buffer;
}

/** Read EXIF from original JPEG bytes (before canvas strips it). */
async function readExifFromJpegFile(file: File): Promise<ExifDict | null> {
  if (!isJpegFile(file)) return null;
  try {
    const buf = await file.arrayBuffer();
    return piexif.load(arrayBufferToBinaryString(buf));
  } catch {
    return null;
  }
}

/**
 * Canvas draw applies orientation; reset tag so backend exif_transpose does not rotate again.
 */
function exifForCanvasOutput(exifObj: ExifDict): ExifDict {
  const copy = JSON.parse(JSON.stringify(exifObj)) as ExifDict;
  if (copy['0th']) {
    copy['0th'][piexif.ImageIFD.Orientation] = 1;
  }
  return copy;
}

async function injectExifIntoJpegBlob(blob: Blob, sourceExif: ExifDict | null): Promise<Blob> {
  if (!sourceExif) return blob;
  try {
    const jpegBinary = arrayBufferToBinaryString(await blob.arrayBuffer());
    const exifBytes = piexif.dump(exifForCanvasOutput(sourceExif));
    const withExif = piexif.insert(exifBytes, jpegBinary);
    return new Blob([binaryStringToArrayBuffer(withExif)], { type: 'image/jpeg' });
  } catch {
    return blob;
  }
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
  sourceExif: ExifDict | null,
): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          reject(new Error('encode_failed'));
          return;
        }
        const withExif = await injectExifIntoJpegBlob(blob, sourceExif);
        resolve(new File([withExif], name, { type: 'image/jpeg', lastModified: Date.now() }));
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
  if (preparedUploadFiles.has(file)) {
    return file;
  }

  if (file.size > MAX_RAW_FILE_BYTES) {
    throw new Error(
      `File is too large (${(MAX_RAW_FILE_BYTES / 1024 / 1024).toFixed(0)} MB max from device).`,
    );
  }

  if (!canDecodeInBrowser(file)) {
    if (file.size <= MAX_UPLOAD_BYTES) {
      markUploadFilePrepared(file);
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
        markUploadFilePrepared(file);
        return file;
      }
    } catch {
      markUploadFilePrepared(file);
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

  const sourceExif = await readExifFromJpegFile(file);

  let out = await canvasToJpegFile(canvas, outputName(file.name), UPLOAD_JPEG_QUALITY, sourceExif);

  if (out.size > MAX_UPLOAD_BYTES) {
    out = await canvasToJpegFile(canvas, outputName(file.name), 0.72, sourceExif);
  }
  if (out.size > MAX_UPLOAD_BYTES) {
    out = await canvasToJpegFile(canvas, outputName(file.name), 0.58, sourceExif);
  }
  if (out.size > MAX_UPLOAD_BYTES) {
    throw new Error('Image is still too large after optimization. Try a smaller photo.');
  }

  markUploadFilePrepared(out);
  return out;
}

export async function prepareImagesForUpload(files: File[]): Promise<File[]> {
  return Promise.all(files.map((f) => prepareImageForUpload(f)));
}
