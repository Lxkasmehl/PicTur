import { useEffect, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import {
  hydrateGame,
  markTrainingCompleted,
  grantVerifiedObserverBadge,
  resetCommunityGame,
} from '../../store/slices/communityGameSlice';
import type { CommunityGamePersistedState } from '../../store/slices/communityGameSlice';
import { readPersistedGame, storageKeyForUser, writePersistedGame } from '../../gamification/persistence';
import { fetchCommunityGameState, saveCommunityGameState } from '../../services/api/communityGame';
import { isEmailVerified } from '../../utils/emailVerified';
import { store } from '../../store';

function pickPersisted(s: {
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
}): CommunityGamePersistedState {
  return {
    totalXp: s.totalXp,
    lifetimeSightings: s.lifetimeSightings,
    questWeekKey: s.questWeekKey,
    weeklySightings: s.weeklySightings,
    weeklyGpsSightings: s.weeklyGpsSightings,
    weeklyExtraSightings: s.weeklyExtraSightings,
    weeksWithUpload: [...s.weeksWithUpload],
    gpsHintTotal: s.gpsHintTotal,
    manualHintTotal: s.manualHintTotal,
    sightingsWithExtraPhotos: s.sightingsWithExtraPhotos,
    trainingCompleted: s.trainingCompleted,
    badges: [...s.badges],
    completedWeeklyQuestIds: [...s.completedWeeklyQuestIds],
  };
}

/**
 * Observer gamification: any logged-in account (all roles) syncs to the auth service by user id.
 * Guests get a reset slice—no local XP storage (avoids “lost progress” confusion).
 */
export default function GamePersistence(): null {
  const dispatch = useAppDispatch();
  const authChecked = useAppSelector((s) => s.user.authChecked);
  const userId = useAppSelector((s) => s.user.user?.id ?? null);
  const user = useAppSelector((s) => s.user.user);
  const game = useAppSelector((s) => s.communityGame);

  /** When false, debounced PUT is skipped (during initial server merge for community users). */
  const serverWriteEnabledRef = useRef(true);

  useEffect(() => {
    if (!authChecked) return;

    let cancelled = false;

    const applyInstructionsFlag = (): void => {
      try {
        if (localStorage.getItem('hasSeenInstructions') === 'true') {
          dispatch(markTrainingCompleted());
        }
      } catch {
        /* ignore */
      }
    };

    void (async () => {
      if (userId == null) {
        serverWriteEnabledRef.current = false;
        try {
          localStorage.removeItem(storageKeyForUser(null));
        } catch {
          /* ignore */
        }
        dispatch(resetCommunityGame());
        return;
      }

      serverWriteEnabledRef.current = false;
      try {
        localStorage.removeItem(storageKeyForUser(null));
      } catch {
        /* ignore */
      }

      let serverData: CommunityGamePersistedState | null = null;
      let loadedFromServer = false;
      try {
        serverData = await fetchCommunityGameState();
        loadedFromServer = true;
      } catch {
        serverData = readPersistedGame(storageKeyForUser(userId));
      }

      if (cancelled) return;

      const fallback = readPersistedGame(storageKeyForUser(userId));
      const payload = serverData ?? fallback ?? {};
      dispatch(hydrateGame(payload));

      const u = store.getState().user.user;
      if (u != null && isEmailVerified(u)) {
        dispatch(grantVerifiedObserverBadge());
      }

      const persisted = pickPersisted(store.getState().communityGame);
      const serverJson = serverData != null ? JSON.stringify(serverData) : null;
      let initialSaveFailed = false;
      if (serverJson !== JSON.stringify(persisted)) {
        try {
          await saveCommunityGameState(persisted);
        } catch {
          initialSaveFailed = true;
        }
      }

      if (initialSaveFailed) {
        writePersistedGame(storageKeyForUser(userId), persisted);
      } else if (loadedFromServer) {
        try {
          localStorage.removeItem(storageKeyForUser(userId));
        } catch {
          /* ignore */
        }
      }

      if (cancelled) return;

      applyInstructionsFlag();
      serverWriteEnabledRef.current = true;
    })();

    return () => {
      cancelled = true;
    };
  }, [authChecked, userId, dispatch]);

  useEffect(() => {
    if (!authChecked || !user) return;
    if (isEmailVerified(user)) {
      dispatch(grantVerifiedObserverBadge());
    }
  }, [authChecked, user, dispatch]);

  useEffect(() => {
    if (!authChecked || !game.hydrated) return;

    if (userId == null) {
      return;
    }

    if (!serverWriteEnabledRef.current) return;

    const uid = userId;
    const snapshot = pickPersisted(game);
    const t = window.setTimeout(() => {
      saveCommunityGameState(snapshot)
        .then(() => {
          try {
            localStorage.removeItem(storageKeyForUser(uid));
          } catch {
            /* ignore */
          }
        })
        .catch(() => {
          writePersistedGame(storageKeyForUser(uid), snapshot);
        });
    }, 450);
    return () => clearTimeout(t);
  }, [authChecked, userId, game]);

  return null;
}
