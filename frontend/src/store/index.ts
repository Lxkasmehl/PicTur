import { configureStore } from '@reduxjs/toolkit';
import userReducer from './slices/userSlice.js';
import themeReducer from './slices/themeSlice.js';
import availableSheetsReducer from './slices/availableSheetsSlice.js';
import communityGameReducer from './slices/communityGameSlice.js';
import orgReducer from './slices/orgSlice.js';

export const store = configureStore({
  reducer: {
    user: userReducer,
    theme: themeReducer,
    availableSheets: availableSheetsReducer,
    communityGame: communityGameReducer,
    org: orgReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
