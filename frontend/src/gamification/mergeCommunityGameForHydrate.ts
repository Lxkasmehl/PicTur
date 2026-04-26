import type { CommunityGamePersistedState } from './definitions';
import { pickWeeklyQuestIds } from './definitions';
import { getISOWeekKey } from './isoWeek';

/**
 * Combines server and local observer snapshots so offline / failed-PUT progress is not lost.
 * Uses monotonic max for lifetime stats and week-aware rules for weekly quest counters.
 */
export function mergeCommunityGameForHydrate(
  server: CommunityGamePersistedState | null,
  local: CommunityGamePersistedState | null,
  nowWeek: string = getISOWeekKey(),
): Partial<CommunityGamePersistedState> {
  if (server == null && local == null) return {};
  if (server == null) return { ...local! };
  if (local == null) return { ...server };

  const s = server;
  const l = local;
  const max = (a: number, b: number) => Math.max(a, b);

  const serverCurrent = s.questWeekKey === nowWeek;
  const localCurrent = l.questWeekKey === nowWeek;
  const activeQuestIds = new Set(pickWeeklyQuestIds(nowWeek));

  const filterActiveQuestCompletions = (ids: string[]): string[] =>
    [...new Set(ids.filter((id) => activeQuestIds.has(id)))];

  let questWeekKey: string;
  let weeklySightings: number;
  let weeklyGpsSightings: number;
  let weeklyExtraSightings: number;
  let completedWeeklyQuestIds: string[];

  if (serverCurrent && localCurrent) {
    questWeekKey = nowWeek;
    weeklySightings = max(s.weeklySightings, l.weeklySightings);
    weeklyGpsSightings = max(s.weeklyGpsSightings, l.weeklyGpsSightings);
    weeklyExtraSightings = max(s.weeklyExtraSightings, l.weeklyExtraSightings);
    completedWeeklyQuestIds = filterActiveQuestCompletions([
      ...s.completedWeeklyQuestIds,
      ...l.completedWeeklyQuestIds,
    ]);
  } else if (localCurrent) {
    questWeekKey = nowWeek;
    weeklySightings = l.weeklySightings;
    weeklyGpsSightings = l.weeklyGpsSightings;
    weeklyExtraSightings = l.weeklyExtraSightings;
    completedWeeklyQuestIds = filterActiveQuestCompletions(l.completedWeeklyQuestIds);
  } else if (serverCurrent) {
    questWeekKey = nowWeek;
    weeklySightings = s.weeklySightings;
    weeklyGpsSightings = s.weeklyGpsSightings;
    weeklyExtraSightings = s.weeklyExtraSightings;
    completedWeeklyQuestIds = filterActiveQuestCompletions(s.completedWeeklyQuestIds);
  } else {
    questWeekKey = nowWeek;
    weeklySightings = 0;
    weeklyGpsSightings = 0;
    weeklyExtraSightings = 0;
    completedWeeklyQuestIds = [];
  }

  const weeksWithUpload = [...new Set([...s.weeksWithUpload, ...l.weeksWithUpload])].slice(-60);
  const badges = [...new Set([...s.badges, ...l.badges])];

  return {
    totalXp: max(s.totalXp, l.totalXp),
    lifetimeSightings: max(s.lifetimeSightings, l.lifetimeSightings),
    questWeekKey,
    weeklySightings,
    weeklyGpsSightings,
    weeklyExtraSightings,
    weeksWithUpload,
    gpsHintTotal: max(s.gpsHintTotal, l.gpsHintTotal),
    manualHintTotal: max(s.manualHintTotal, l.manualHintTotal),
    sightingsWithExtraPhotos: max(s.sightingsWithExtraPhotos, l.sightingsWithExtraPhotos),
    trainingCompleted: s.trainingCompleted || l.trainingCompleted,
    badges,
    completedWeeklyQuestIds,
  };
}
