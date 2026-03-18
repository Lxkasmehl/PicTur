import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { createTheme } from '@mantine/core';

// Community theme (blue-based)
const communityTheme = createTheme({
  primaryColor: 'blue',
  colors: {
    blue: [
      '#e7f5ff',
      '#d0ebff',
      '#a5d8ff',
      '#74c0fc',
      '#4dabf7',
      '#339af0',
      '#228be6',
      '#1c7ed6',
      '#1971c2',
      '#1864ab',
    ],
  },
});

// Staff theme (orange-based)
const staffTheme = createTheme({
  primaryColor: 'orange',
  colors: {
    orange: [
      '#fff4e6',
      '#ffe8cc',
      '#ffd8a8',
      '#ffc078',
      '#ffa94d',
      '#ff922b',
      '#fd7e14',
      '#f76707',
      '#e8590c',
      '#d9480f',
    ],
  },
});

// Admin theme (red-based)
const adminTheme = createTheme({
  primaryColor: 'red',
  colors: {
    red: [
      '#fff5f5',
      '#ffe3e3',
      '#ffc9c9',
      '#ffa8a8',
      '#ff8787',
      '#ff6b6b',
      '#fa5252',
      '#f03e3e',
      '#e03131',
      '#c92a2a',
    ],
  },
});

export type RoleThemeType = 'community' | 'staff' | 'admin';

interface ThemeState {
  themeType: RoleThemeType;
}

const initialState: ThemeState = {
  themeType: 'community',
};

const themeSlice = createSlice({
  name: 'theme',
  initialState,
  reducers: {
    setThemeType: (state, action: PayloadAction<RoleThemeType>) => {
      state.themeType = action.payload;
    },
  },
});

export const { setThemeType } = themeSlice.actions;
export { communityTheme, staffTheme, adminTheme };
export default themeSlice.reducer;
