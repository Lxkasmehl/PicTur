/** Washburn University turtle research team — public context and outreach. */
export const WASHBURN_TURTLE_LAB_URL = 'https://wu-turtle.weebly.com/';

/** Weebly contact form for the lab (no PicTur backend required). */
export const WASHBURN_TURTLE_CONTACT_URL = 'https://wu-turtle.weebly.com/contact.html';

/**
 * Lab email for direct outreach (mailto on the PicTur contact page).
 * Set at build time, e.g. `VITE_CONTACT_EMAIL=you@washburn.edu`.
 */
export function getLabContactEmail(): string | undefined {
  const v = import.meta.env.VITE_CONTACT_EMAIL;
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}
