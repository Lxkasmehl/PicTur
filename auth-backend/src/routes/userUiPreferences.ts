import express, { Response } from 'express';
import { getUserUiPreferences, saveUserUiPreferences } from '../db/database.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import type { UserUiPreferencesPayload } from '../types/userUiPreferences.js';

const router = express.Router();

const MAX_FAVORITES = 64;
const MAX_PATH_LEN = 512;

function parsePayload(body: unknown): UserUiPreferencesPayload | null {
  if (!body || typeof body !== 'object') return null;
  const o = body as Record<string, unknown>;
  const v = o.homeMatchScopeFavorites;
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of v) {
    if (typeof item !== 'string' || item.length > MAX_PATH_LEN) return null;
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
    if (out.length > MAX_FAVORITES) return null;
  }
  return { homeMatchScopeFavorites: out };
}

/** GET current user's UI preferences (match-scope favorites, etc.) */
router.get('/user-ui-preferences', authenticateToken, (req: AuthRequest, res: Response) => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }
  const preferences = getUserUiPreferences(user.id);
  res.json({ success: true, preferences });
});

/** PUT replace UI preferences */
router.put('/user-ui-preferences', authenticateToken, (req: AuthRequest, res: Response) => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }
  const parsed = parsePayload(req.body);
  if (!parsed) {
    res.status(400).json({ success: false, error: 'Invalid preferences payload' });
    return;
  }
  try {
    saveUserUiPreferences(user.id, parsed);
    res.json({ success: true });
  } catch (e) {
    console.error('saveUserUiPreferences', e);
    res.status(500).json({ success: false, error: 'Failed to save preferences' });
  }
});

export default router;
