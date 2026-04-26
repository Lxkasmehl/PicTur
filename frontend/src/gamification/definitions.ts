import { getISOWeekKey } from './isoWeek';

export const GAME_STORAGE_VERSION = 1;
export const GAME_STORAGE_PREFIX = 'tt_community_game_v1';

/** Serialized localStorage shape; same fields as Redux `communityGame` persisted slice */
export interface CommunityGamePersistedState {
  totalXp: number;
  lifetimeSightings: number;
  questWeekKey: string;
  weeklySightings: number;
  weeklyGpsSightings: number;
  weeklyExtraSightings: number;
  weeksWithUpload: string[];
  gpsHintTotal: number;
  manualHintTotal: number;
  sightingsWithExtraPhotos: number;
  trainingCompleted: boolean;
  badges: string[];
  completedWeeklyQuestIds: string[];
}

export const XP_LEVEL_THRESHOLDS = [
  0, 120, 320, 600, 1000, 1500, 2200, 3100, 4300, 5800, 7600, 10000, 13000,
] as const;

export function levelFromTotalXp(totalXp: number): number {
  let level = 1;
  for (let i = 1; i < XP_LEVEL_THRESHOLDS.length; i++) {
    if (totalXp >= XP_LEVEL_THRESHOLDS[i]) level = i + 1;
    else break;
  }
  return Math.min(level, XP_LEVEL_THRESHOLDS.length);
}

export function xpToNextLevel(totalXp: number): { currentLevel: number; intoLevel: number; needed: number } {
  const currentLevel = levelFromTotalXp(totalXp);
  const capIdx = XP_LEVEL_THRESHOLDS.length - 1;
  if (currentLevel >= capIdx + 1) {
    return { currentLevel, intoLevel: totalXp - XP_LEVEL_THRESHOLDS[capIdx], needed: 0 };
  }
  const nextThreshold = XP_LEVEL_THRESHOLDS[currentLevel];
  return {
    currentLevel,
    intoLevel: totalXp - XP_LEVEL_THRESHOLDS[currentLevel - 1],
    needed: nextThreshold - totalXp,
  };
}

export type BadgeDefinition = {
  id: string;
  title: string;
  description: string;
  /** Tabler icon name fragment (e.g. IconCamera) — resolved in UI */
  icon: string;
};

export const BADGE_DEFINITIONS: BadgeDefinition[] = [
  {
    id: 'first_sighting',
    title: 'First Sighting',
    description: 'Submitted your first turtle photo to the project.',
    icon: 'IconSparkles',
  },
  {
    id: 'sightings_5',
    title: 'Regular Spotter',
    description: 'Five successful sightings logged.',
    icon: 'IconBinoculars',
  },
  {
    id: 'sightings_25',
    title: 'Field Regular',
    description: 'Twenty-five sightings — the turtles know your camera.',
    icon: 'IconTrekking',
  },
  {
    id: 'sightings_100',
    title: 'Citizen Scientist',
    description: 'One hundred sightings. Incredible dedication.',
    icon: 'IconAward',
  },
  {
    id: 'gps_scout',
    title: 'GPS Scout',
    description: 'Shared GPS location hints ten times.',
    icon: 'IconCurrentLocation',
  },
  {
    id: 'map_navigator',
    title: 'Map Navigator',
    description: 'Pinned ten locations manually on the map.',
    icon: 'IconMapPin',
  },
  {
    id: 'detail_oriented',
    title: 'Detail Oriented',
    description: 'Added extra microhabitat or condition photos on five uploads.',
    icon: 'IconPhotoPlus',
  },
  {
    id: 'week_warrior',
    title: 'Week Warrior',
    description: 'Active at least one sighting in three consecutive weeks.',
    icon: 'IconFlame',
  },
  {
    id: 'verified_observer',
    title: 'Verified Observer',
    description: 'Verified your email — thank you for helping us stay in touch.',
    icon: 'IconMailCheck',
  },
  {
    id: 'scholar',
    title: 'Field Scholar',
    description: 'Completed the full photo submission training.',
    icon: 'IconBook',
  },
  {
    id: 'rising_star',
    title: 'Rising Star',
    description: 'Reached observer level 5.',
    icon: 'IconStar',
  },
  {
    id: 'veteran_observer',
    title: 'Veteran Observer',
    description: 'Reached observer level 10.',
    icon: 'IconCrown',
  },
];

export const BADGE_BY_ID: Record<string, BadgeDefinition> = Object.fromEntries(
  BADGE_DEFINITIONS.map((b) => [b.id, b]),
);

export type WeeklyQuestDef = {
  id: string;
  title: string;
  description: string;
  target: number;
  bonusXp: number;
};

/** Two rotating weekly quests; index derived from ISO year + week for variety. */
export const WEEKLY_QUEST_POOL: WeeklyQuestDef[] = [
  {
    id: 'weekly_three_sightings',
    title: 'Weekly: Three sightings',
    description: 'Log three successful uploads this calendar week.',
    target: 3,
    bonusXp: 45,
  },
  {
    id: 'weekly_two_gps',
    title: 'Weekly: Pin it twice',
    description: 'Include a GPS location hint on two sightings this week.',
    target: 2,
    bonusXp: 40,
  },
  {
    id: 'weekly_detail',
    title: 'Weekly: Extra context',
    description: 'Add at least one extra photo on two uploads this week.',
    target: 2,
    bonusXp: 50,
  },
];

export function activeWeeklyQuestsForWeek(weekKey: string): WeeklyQuestDef[] {
  const [, w] = weekKey.split('-W');
  const weekNum = Number(w) || 1;
  const a = weekNum % WEEKLY_QUEST_POOL.length;
  const b = (weekNum + 2) % WEEKLY_QUEST_POOL.length;
  const first = WEEKLY_QUEST_POOL[a];
  const second = WEEKLY_QUEST_POOL[b === a ? (b + 1) % WEEKLY_QUEST_POOL.length : b];
  return [first, second];
}

export function pickWeeklyQuestIds(weekKey: string = getISOWeekKey()): string[] {
  return activeWeeklyQuestsForWeek(weekKey).map((q) => q.id);
}
