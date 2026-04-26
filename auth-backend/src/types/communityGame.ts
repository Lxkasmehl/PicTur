/**
 * Observer / gamification progress stored per auth user (matches frontend `CommunityGamePersistedState`).
 */
export interface CommunityGamePersistedPayload {
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
