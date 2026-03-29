import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { getISOWeekKey, consecutiveWeeksEndingAt } from '../../gamification/isoWeek';
import {
  levelFromTotalXp,
  pickWeeklyQuestIds,
  WEEKLY_QUEST_POOL,
  type CommunityGamePersistedState,
} from '../../gamification/definitions';

export type { CommunityGamePersistedState };

export interface PendingRewards {
  xpGained: number;
  newBadgeIds: string[];
  questTitles?: string[];
}

export interface CommunityGameState extends CommunityGamePersistedState {
  hydrated: boolean;
  pendingRewards: PendingRewards | null;
}

const initialPersisted: CommunityGamePersistedState = {
  totalXp: 0,
  lifetimeSightings: 0,
  questWeekKey: '',
  weeklySightings: 0,
  weeklyGpsSightings: 0,
  weeklyExtraSightings: 0,
  weeksWithUpload: [],
  gpsHintTotal: 0,
  manualHintTotal: 0,
  sightingsWithExtraPhotos: 0,
  trainingCompleted: false,
  badges: [],
  completedWeeklyQuestIds: [],
};

const initialState: CommunityGameState = {
  ...initialPersisted,
  hydrated: false,
  pendingRewards: null,
};

function resetWeeklyProgress(state: CommunityGamePersistedState, weekKey: string): void {
  state.questWeekKey = weekKey;
  state.weeklySightings = 0;
  state.weeklyGpsSightings = 0;
  state.weeklyExtraSightings = 0;
  state.completedWeeklyQuestIds = [];
}

function questDefById(id: string) {
  return WEEKLY_QUEST_POOL.find((q) => q.id === id);
}

function collectNewBadges(s: CommunityGamePersistedState): string[] {
  const has = new Set(s.badges);
  const next: string[] = [];

  const tryAdd = (id: string, ok: boolean) => {
    if (ok && !has.has(id)) {
      has.add(id);
      next.push(id);
    }
  };

  tryAdd('first_sighting', s.lifetimeSightings >= 1);
  tryAdd('sightings_5', s.lifetimeSightings >= 5);
  tryAdd('sightings_25', s.lifetimeSightings >= 25);
  tryAdd('sightings_100', s.lifetimeSightings >= 100);
  tryAdd('gps_scout', s.gpsHintTotal >= 10);
  tryAdd('map_navigator', s.manualHintTotal >= 10);
  tryAdd('detail_oriented', s.sightingsWithExtraPhotos >= 5);
  const weekSet = new Set(s.weeksWithUpload);
  const streak = consecutiveWeeksEndingAt(getISOWeekKey(), weekSet);
  tryAdd('week_warrior', streak >= 3);
  tryAdd('scholar', s.trainingCompleted);
  tryAdd('rising_star', levelFromTotalXp(s.totalXp) >= 5);
  tryAdd('veteran_observer', levelFromTotalXp(s.totalXp) >= 10);

  return next;
}

const communityGameSlice = createSlice({
  name: 'communityGame',
  initialState,
  reducers: {
    hydrateGame: (state, action: PayloadAction<Partial<CommunityGamePersistedState>>) => {
      const p = action.payload;
      state.totalXp = p.totalXp ?? initialPersisted.totalXp;
      state.lifetimeSightings = p.lifetimeSightings ?? initialPersisted.lifetimeSightings;
      state.questWeekKey = p.questWeekKey ?? initialPersisted.questWeekKey;
      state.weeklySightings = p.weeklySightings ?? initialPersisted.weeklySightings;
      state.weeklyGpsSightings = p.weeklyGpsSightings ?? initialPersisted.weeklyGpsSightings;
      state.weeklyExtraSightings = p.weeklyExtraSightings ?? initialPersisted.weeklyExtraSightings;
      state.weeksWithUpload = p.weeksWithUpload ?? [...initialPersisted.weeksWithUpload];
      state.gpsHintTotal = p.gpsHintTotal ?? initialPersisted.gpsHintTotal;
      state.manualHintTotal = p.manualHintTotal ?? initialPersisted.manualHintTotal;
      state.sightingsWithExtraPhotos =
        p.sightingsWithExtraPhotos ?? initialPersisted.sightingsWithExtraPhotos;
      state.trainingCompleted = p.trainingCompleted ?? initialPersisted.trainingCompleted;
      state.badges = p.badges ?? [...initialPersisted.badges];
      state.completedWeeklyQuestIds =
        p.completedWeeklyQuestIds ?? [...initialPersisted.completedWeeklyQuestIds];
      state.hydrated = true;
      state.pendingRewards = null;
    },

    /** Call when user.email_verified becomes true */
    grantVerifiedObserverBadge: (state) => {
      if (state.badges.includes('verified_observer')) return;
      state.badges.push('verified_observer');
    },

    markTrainingCompleted: (state) => {
      state.trainingCompleted = true;
      const before = new Set(state.badges);
      const newOnes = collectNewBadges(state).filter((id) => !before.has(id));
      for (const id of newOnes) state.badges.push(id);
    },

    recordCommunitySighting: (
      state,
      action: PayloadAction<{
        hasGps: boolean;
        hasManual: boolean;
        extraPhotoCount: number;
      }>,
    ) => {
      const { hasGps, hasManual, extraPhotoCount } = action.payload;
      const weekKey = getISOWeekKey();

      if (state.questWeekKey !== weekKey) {
        resetWeeklyProgress(state, weekKey);
      }

      let xpGain = 30;
      if (hasGps) xpGain += 12;
      if (hasManual) xpGain += 8;
      xpGain += Math.min(Math.max(0, extraPhotoCount) * 5, 20);

      state.lifetimeSightings += 1;
      state.weeklySightings += 1;
      if (hasGps) {
        state.gpsHintTotal += 1;
        state.weeklyGpsSightings += 1;
      }
      if (hasManual) {
        state.manualHintTotal += 1;
      }
      if (extraPhotoCount > 0) {
        state.sightingsWithExtraPhotos += 1;
        state.weeklyExtraSightings += 1;
      }

      const wk = new Set(state.weeksWithUpload);
      wk.add(weekKey);
      state.weeksWithUpload = Array.from(wk).slice(-60);

      const questTitles: string[] = [];
      const activeIds = pickWeeklyQuestIds(weekKey);
      const completed = new Set(state.completedWeeklyQuestIds);

      for (const qid of activeIds) {
        if (completed.has(qid)) continue;
        const def = questDefById(qid);
        if (!def) continue;
        let done = false;
        if (qid === 'weekly_three_sightings' && state.weeklySightings >= def.target) done = true;
        if (qid === 'weekly_two_gps' && state.weeklyGpsSightings >= def.target) done = true;
        if (qid === 'weekly_detail' && state.weeklyExtraSightings >= def.target) done = true;
        if (done) {
          completed.add(qid);
          state.completedWeeklyQuestIds.push(qid);
          xpGain += def.bonusXp;
          questTitles.push(def.title);
        }
      }

      const badgesBefore = new Set(state.badges);
      state.totalXp += xpGain;

      const newBadgeIds = collectNewBadges(state).filter((id) => !badgesBefore.has(id));
      for (const id of newBadgeIds) {
        state.badges.push(id);
      }

      state.pendingRewards = {
        xpGained: xpGain,
        newBadgeIds,
        questTitles: questTitles.length ? questTitles : undefined,
      };
    },

    clearPendingRewards: (state) => {
      state.pendingRewards = null;
    },

    resetCommunityGame: () => ({ ...initialState, hydrated: true }),
  },
});

export const {
  hydrateGame,
  grantVerifiedObserverBadge,
  markTrainingCompleted,
  recordCommunitySighting,
  clearPendingRewards,
  resetCommunityGame,
} = communityGameSlice.actions;

export default communityGameSlice.reducer;
