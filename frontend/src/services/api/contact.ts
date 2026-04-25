import { AUTH_API_BASE_URL } from './config';

export interface SubmitContactFormInput {
  name: string;
  email: string;
  message: string;
}

export type SubmitContactFormResult =
  | { ok: true }
  | { ok: false; error: string; status: number; code?: string };

export async function submitContactForm(
  body: SubmitContactFormInput,
): Promise<SubmitContactFormResult> {
  const res = await fetch(`${AUTH_API_BASE_URL}/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
    ok?: boolean;
  };
  if (!res.ok) {
    return {
      ok: false,
      error: data.error || res.statusText || 'Request failed',
      status: res.status,
      code: data.code,
    };
  }
  return { ok: true };
}
