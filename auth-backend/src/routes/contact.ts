import { Router, type Request, type Response } from 'express';
import {
  isSmtpConfigured,
  parseContactFormRecipients,
  sendContactFormNotification,
} from '../services/email.js';

const router = Router();

const SIMPLE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX = 6;

const rateBuckets = new Map<string, number[]>();

function clientIp(req: Request): string {
  // req.ip respects Express trust proxy settings and ignores untrusted forwarded headers.
  const rawIp = req.ip || req.socket.remoteAddress;
  if (!rawIp) return 'unknown';
  return rawIp.startsWith('::ffff:') ? rawIp.slice(7) : rawIp;
}

function rateLimitOk(ip: string): boolean {
  const now = Date.now();
  const windowStart = now - RATE_WINDOW_MS;
  let hits = rateBuckets.get(ip) || [];
  hits = hits.filter((t) => t > windowStart);
  if (hits.length >= RATE_MAX) {
    rateBuckets.set(ip, hits);
    return false;
  }
  hits.push(now);
  rateBuckets.set(ip, hits);
  return true;
}

function validateBody(body: unknown): { name: string; email: string; message: string } | null {
  if (!body || typeof body !== 'object') return null;
  const o = body as Record<string, unknown>;
  const name = typeof o.name === 'string' ? o.name.trim() : '';
  const email = typeof o.email === 'string' ? o.email.trim() : '';
  const message = typeof o.message === 'string' ? o.message.trim() : '';
  if (name.length < 1 || name.length > 200) return null;
  if (!SIMPLE_EMAIL.test(email) || email.length > 254) return null;
  if (message.length < 1 || message.length > 12000) return null;
  return { name, email, message };
}

/** Public: submit PicTur / lab outreach message; delivers to CONTACT_FORM_RECIPIENTS (SMTP). */
router.post('/contact', async (req: Request, res: Response) => {
  const ip = clientIp(req);
  if (!rateLimitOk(ip)) {
    return res.status(429).json({ error: 'Too many submissions. Please try again later.' });
  }

  const parsed = validateBody(req.body);
  if (!parsed) {
    return res.status(400).json({ error: 'Invalid name, email, or message.' });
  }

  const recipients = parseContactFormRecipients();
  if (recipients.length === 0) {
    return res.status(503).json({
      error: 'Contact form is not configured on this server.',
      code: 'CONTACT_DISABLED',
    });
  }

  if (!isSmtpConfigured()) {
    return res.status(503).json({
      error: 'Contact form is temporarily unavailable.',
      code: 'CONTACT_UNAVAILABLE',
    });
  }

  try {
    await sendContactFormNotification({ ...parsed, recipients });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Send failed';
    console.error('Contact form send error:', msg);
    return res.status(500).json({ error: 'Failed to send email. Please try again later.' });
  }

  return res.status(200).json({ ok: true });
});

export default router;
