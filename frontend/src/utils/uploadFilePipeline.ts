import { validateFile } from './fileValidation';
import { formatPrepareUploadError, prepareImageForUpload } from './prepareImageForUpload';

export interface AcceptUploadFileResult {
  isValid: boolean;
  file?: File;
  error?: string;
}

/** Optimize then validate — use for every user-selected upload file. */
export async function acceptUploadFile(file: File): Promise<AcceptUploadFileResult> {
  try {
    const prepared = await prepareImageForUpload(file);
    const validation = validateFile(prepared);
    if (!validation.isValid) {
      return { isValid: false, error: validation.error };
    }
    return { isValid: true, file: prepared };
  } catch (e) {
    return { isValid: false, error: formatPrepareUploadError(e) };
  }
}
