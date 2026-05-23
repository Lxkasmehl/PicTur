import piexif, { type ExifDict } from 'piexifjs';
import {
  MAX_RAW_FILE_BYTES,
  MAX_UPLOAD_BYTES,
  UPLOAD_JPEG_QUALITY,
  UPLOAD_MAX_DIMENSION,
  UPLOAD_SKIP_COMPRESS_BELOW_BYTES,
} from './uploadConstants';
import { userFacingUploadError } from './uploadErrorMessages';

const COMPRESSIBLE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
]);
const COMPRESSIBLE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);

/**
 * Thrown when <img> decode fails and createImageBitmap is unavailable.
 * prepareImageForUpload passes the file through for backend repair.
 */
const CLIENT_DECODE_UNAVAILABLE = 'client_decode_unavailable';

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

async function loadViaImageElement(file: File): Promise<HTMLImageElement> {
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

/** createImageBitmap often decodes PNG/JPEG variants that <img> rejects (e.g. some Word exports). */
async function loadViaImageBitmap(file: File): Promise<HTMLImageElement> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('decode_failed');
    ctx.drawImage(bitmap, 0, 0);
    const dataUrl = canvas.toDataURL('image/png');
    return loadViaDataUrl(dataUrl);
  } finally {
    bitmap.close();
  }
}

function loadViaDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('decode_failed'));
    img.src = dataUrl;
  });
}

async function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  try {
    return await loadViaImageElement(file);
  } catch {
    if (typeof createImageBitmap !== 'function') {
      throw new Error(CLIENT_DECODE_UNAVAILABLE);
    }
    return loadViaImageBitmap(file);
  }
}

function passThroughForServerDecode(file: File): File {
  markUploadFilePrepared(file);
  return file;
}

function tryPassThroughOnClientDecodeFailure(e: unknown, file: File): File | null {
  if (
    e instanceof Error &&
    e.message === CLIENT_DECODE_UNAVAILABLE &&
    file.size <= MAX_UPLOAD_BYTES
  ) {
    return passThroughForServerDecode(file);
  }
  return null;
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

async function reencodeToJpegFile(file: File): Promise<File> {
  const img = await loadImageFromFile(file);
  const srcW = img.naturalWidth;
  const srcH = img.naturalHeight;
  if (!srcW || !srcH) {
    throw new Error('decode_failed');
  }

  const scale = Math.min(1, UPLOAD_MAX_DIMENSION / Math.max(srcW, srcH));
  const dstW = Math.max(1, Math.round(srcW * scale));
  const dstH = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = dstW;
  canvas.height = dstH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('encode_failed');
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
    throw new Error('file_too_large');
  }

  markUploadFilePrepared(out);
  return out;
}

/**
 * Resize and re-encode photos before upload so smartphone originals (often 5–15 MB)
 * fit server limits without raising the attack surface.
 * HEIC/HEIF is passed through when the browser cannot decode it (server normalizes),
 * unless the file exceeds MAX_UPLOAD_BYTES (size error, not invalid type).
 */
export async function prepareImageForUpload(file: File): Promise<File> {
  if (preparedUploadFiles.has(file)) {
    return file;
  }

  if (file.size > MAX_RAW_FILE_BYTES) {
    throw new Error('file_too_large');
  }

  if (!canDecodeInBrowser(file)) {
    if (file.size <= MAX_UPLOAD_BYTES) {
      markUploadFilePrepared(file);
      return file;
    }
    throw new Error('file_too_large');
  }

  if (file.size <= UPLOAD_SKIP_COMPRESS_BELOW_BYTES) {
    try {
      const img = await loadImageFromFile(file);
      if (Math.max(img.naturalWidth, img.naturalHeight) <= UPLOAD_MAX_DIMENSION) {
        markUploadFilePrepared(file);
        return file;
      }
    } catch (e) {
      const passthrough = tryPassThroughOnClientDecodeFailure(e, file);
      if (passthrough) return passthrough;
      // Fall through — re-encode corrupt/small Word/email exports instead of passing them through.
    }
  }

  try {
    return await reencodeToJpegFile(file);
  } catch (e) {
    const passthrough = tryPassThroughOnClientDecodeFailure(e, file);
    if (passthrough) return passthrough;
    throw e;
  }
}

export async function prepareImagesForUpload(files: File[]): Promise<File[]> {
  return Promise.all(files.map((f) => prepareImageForUpload(f)));
}

/** Normalize thrown values from prepareImageForUpload for UI display. */
export function formatPrepareUploadError(e: unknown): string {
  if (e instanceof Error) {
    return userFacingUploadError(e.message);
  }
  return userFacingUploadError();
}
