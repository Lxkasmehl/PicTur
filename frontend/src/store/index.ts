import { configureStore } from '@reduxjs/toolkit';
import userReducer from './slices/userSlice.js';
import themeReducer from './slices/themeSlice.js';
import availableSheetsReducer from './slices/availableSheetsSlice.js';
import communityGameReducer from './slices/communityGameSlice.js';
import orgReducer from './slices/orgSlice.js';
import { setApiOrgSlug } from '../services/api/orgContext';

export const store = configureStore({
  reducer: {
    user: userReducer,
    theme: themeReducer,
    availableSheets: availableSheetsReducer,
    communityGame: communityGameReducer,
    org: orgReducer,
  },
});

// Flask API requests carry the active research group (see services/api/orgContext.ts). Updated
// synchronously on dispatch so pages that remount after a switch already fetch the new group.
setApiOrgSlug(store.getState().org.activeSlug);
store.subscribe(() => setApiOrgSlug(store.getState().org.activeSlug));

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
