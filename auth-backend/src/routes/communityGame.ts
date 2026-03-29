import express, { Response } from 'express';
import {
  getCommunityGameForUser,
  saveCommunityGameForUser,
} from '../db/database.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import type { CommunityGamePersistedPayload } from '../types/communityGame.js';

const router = express.Router();

const MAX_XP = 1_000_000_000;
const MAX_SIGHTINGS = 1_000_000;
const MAX_ARRAY = 200;
const MAX_BADGE_LEN = 64;

function isIsoWeekKey(s: string): boolean {
  return /^\d{4}-W\d{2}$/.test(s);
}

function parsePayload(body: unknown): CommunityGamePersistedPayload | null {
  if (!body || typeof body !== 'object') return null;
  const o = body as Record<string, unknown>;

  const num = (k: string): number | null => {
    const v = o[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    return v;
  };
  const str = (k: string): string | null => {
    const v = o[k];
    return typeof v === 'string' ? v : null;
  };
  const bool = (k: string): boolean | null => {
    const v = o[k];
    if (typeof v !== 'boolean') return null;
    return v;
  };
  const strArr = (k: string): string[] | null => {
    const v = o[k];
    if (!Array.isArray(v)) return null;
    const out: string[] = [];
    for (const item of v) {
      if (typeof item !== 'string' || item.length > MAX_BADGE_LEN) return null;
      out.push(item);
    }
    if (out.length > MAX_ARRAY) return null;
    return out;
  };

  const totalXp = num('totalXp');
  const lifetimeSightings = num('lifetimeSightings');
  const weeklySightings = num('weeklySightings');
  const weeklyGpsSightings = num('weeklyGpsSightings');
  const weeklyExtraSightings = num('weeklyExtraSightings');
  const gpsHintTotal = num('gpsHintTotal');
  const manualHintTotal = num('manualHintTotal');
  const sightingsWithExtraPhotos = num('sightingsWithExtraPhotos');
  if (
    totalXp == null ||
    lifetimeSightings == null ||
    weeklySightings == null ||
    weeklyGpsSightings == null ||
    weeklyExtraSightings == null ||
    gpsHintTotal == null ||
    manualHintTotal == null ||
    sightingsWithExtraPhotos == null
  ) {
    return null;
  }

  if (
    totalXp < 0 ||
    totalXp > MAX_XP ||
    lifetimeSightings < 0 ||
    lifetimeSightings > MAX_SIGHTINGS ||
    weeklySightings < 0 ||
    weeklyGpsSightings < 0 ||
    weeklyExtraSightings < 0 ||
    gpsHintTotal < 0 ||
    manualHintTotal < 0 ||
    sightingsWithExtraPhotos < 0
  ) {
    return null;
  }

  const questWeekKey = str('questWeekKey');
  if (questWeekKey == null || (questWeekKey !== '' && !isIsoWeekKey(questWeekKey))) {
    return null;
  }

  const trainingCompleted = bool('trainingCompleted');
  if (trainingCompleted == null) return null;

  const badges = strArr('badges');
  const weeksWithUpload = strArr('weeksWithUpload');
  const completedWeeklyQuestIds = strArr('completedWeeklyQuestIds');
  if (badges == null || weeksWithUpload == null || completedWeeklyQuestIds == null) {
    return null;
  }

  for (const w of weeksWithUpload) {
    if (w !== '' && !isIsoWeekKey(w)) return null;
  }

  return {
    totalXp,
    lifetimeSightings,
    questWeekKey,
    weeklySightings,
    weeklyGpsSightings,
    weeklyExtraSightings,
    weeksWithUpload,
    gpsHintTotal,
    manualHintTotal,
    sightingsWithExtraPhotos,
    trainingCompleted,
    badges,
    completedWeeklyQuestIds,
  };
}

/** GET current user's observer / gamification state */
router.get('/community-game', authenticateToken, (req: AuthRequest, res: Response) => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }
  const state = getCommunityGameForUser(user.id);
  res.json({ success: true, state });
});

/** PUT replace full observer state (client is source of truth after merge) */
router.put('/community-game', authenticateToken, (req: AuthRequest, res: Response) => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }
  const parsed = parsePayload(req.body);
  if (!parsed) {
    res.status(400).json({ success: false, error: 'Invalid game state payload' });
    return;
  }
  try {
    saveCommunityGameForUser(user.id, parsed);
    res.json({ success: true });
  } catch (e) {
    console.error('saveCommunityGameForUser', e);
    res.status(500).json({ success: false, error: 'Failed to save game state' });
  }
});

export default router;
