import { AUTH_API_BASE_URL, getToken } from './config';

export type FeedbackCategory = 'bug' | 'feature' | 'feedback';

export interface SubmitFeedbackInput {
  category: FeedbackCategory;
  title: string;
  description: string;
  contactEmail?: string;
  contactName?: string;
  /** Signed-in only: if true, server puts account email on the issue body (visible wherever the tracker is visible). */
  includeAccountEmailInIssue?: boolean;
}

export type SubmitFeedbackResult =
  | { ok: true; issueNumber: number; issueUrl: string; projectAdded: boolean }
  | { ok: false; error: string; status: number; code?: string };

function networkFailureMessage(err: unknown): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  return 'Could not reach the server. Check your connection and try again.';
}

export async function submitFeedbackForm(body: SubmitFeedbackInput): Promise<SubmitFeedbackResult> {
  try {
    const token = getToken();
    const res = await fetch(`${AUTH_API_BASE_URL}/feedback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      code?: string;
      ok?: boolean;
      issueNumber?: number;
      issueUrl?: string;
      projectAdded?: boolean;
    };
    if (!res.ok) {
      return {
        ok: false,
        error: data.error || res.statusText || 'Request failed',
        status: res.status,
        code: data.code,
      };
    }
    if (
      typeof data.issueNumber !== 'number' ||
      typeof data.issueUrl !== 'string' ||
      typeof data.projectAdded !== 'boolean'
    ) {
      return { ok: false, error: 'Unexpected response', status: res.status };
    }
    return {
      ok: true,
      issueNumber: data.issueNumber,
      issueUrl: data.issueUrl,
      projectAdded: data.projectAdded,
    };
  } catch (err) {
    return { ok: false, error: networkFailureMessage(err), status: 0 };
  }
}
