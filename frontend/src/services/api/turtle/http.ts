import { getToken } from '../config';
import { parseUploadApiErrorBody } from '../../../utils/uploadErrorMessages';

export function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers = { ...extra };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function throwUploadHttpError(response: Response, fallback: string): Promise<never> {
  const body = await response.json().catch(() => null);
  const { message } = parseUploadApiErrorBody(body, fallback);
  throw new Error(message);
}

export async function throwJsonError(response: Response, fallback: string): Promise<never> {
  const err = await response.json().catch(() => ({ error: fallback }));
  throw new Error(err.error || fallback);
}
