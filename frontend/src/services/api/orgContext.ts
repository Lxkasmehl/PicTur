/**
 * Active research group for requests to the Flask backend.
 *
 * Every page talks to the same Flask routes for every research group; the backend picks the
 * group's data from the `X-Org-Slug` header. Instead of threading the slug through ~40 fetch
 * call sites, `installOrgFetch()` adds the header to every request aimed at TURTLE_API_BASE_URL.
 * URLs that cannot carry headers (<img src>, download links) use `withOrgParam()`.
 */

import { TURTLE_API_BASE_URL } from './config';

export const MAIN_ORG_SLUG = 'main';
const ACTIVE_ORG_KEY = 'active_org';

function initialSlug(): string {
  try {
    return localStorage.getItem(ACTIVE_ORG_KEY) || MAIN_ORG_SLUG;
  } catch {
    return MAIN_ORG_SLUG;
  }
}

let activeSlug = initialSlug();
/** Signed token from the auth service that lets <img> URLs load the user's groups' photos. */
let mediaToken: string | null = null;

/** Called by the org state whenever the (resolved) active group changes. */
export function setApiOrgSlug(slug: string): void {
  activeSlug = slug || MAIN_ORG_SLUG;
}

export function getApiOrgSlug(): string {
  return activeSlug;
}

/** Set from GET /orgs/mine (null when logged out or not in any research group). */
export function setApiMediaToken(token: string | null): void {
  mediaToken = token || null;
}

/**
 * Append `org=<slug>` for URLs used where no header can be sent (images, downloads), plus the
 * media token so photos of groups closed to the community load too.
 */
export function withOrgParam(url: string): string {
  if (activeSlug === MAIN_ORG_SLUG) return url;
  const sep = url.includes('?') ? '&' : '?';
  const mt = mediaToken ? `&mt=${encodeURIComponent(mediaToken)}` : '';
  return `${url}${sep}org=${encodeURIComponent(activeSlug)}${mt}`;
}

let installed = false;

/** Wrap window.fetch once so Flask API requests carry the active research group. */
export function installOrgFetch(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (activeSlug === MAIN_ORG_SLUG || !url.startsWith(TURTLE_API_BASE_URL)) {
      return original(input, init);
    }
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (!headers.has('X-Org-Slug')) headers.set('X-Org-Slug', activeSlug);
    return original(input, { ...init, headers });
  };
}
