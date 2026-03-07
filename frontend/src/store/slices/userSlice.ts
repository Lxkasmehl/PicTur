import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { type UserRole } from '../../types/User';

export interface UserInfo {
  id: number;
  email: string;
  name: string | null;
  role: UserRole;
  email_verified?: boolean;
}

interface UserState {
  role: UserRole;
  isLoggedIn: boolean;
  user: UserInfo | null;
  /** True once AuthProvider has finished initial auth check (token validated or none). */
  authChecked: boolean;
}

const initialState: UserState = {
  role: 'community',
  isLoggedIn: false,
  user: null,
  authChecked: false,
};

const userSlice = createSlice({
  name: 'user',
  initialState,
  reducers: {
    setRole: (state, action: PayloadAction<UserRole>) => {
      state.role = action.payload;
      if (state.user) {
        state.user.role = action.payload;
      }
    },
    setIsLoggedIn: (state, action: PayloadAction<boolean>) => {
      state.isLoggedIn = action.payload;
    },
    setUser: (state, action: PayloadAction<UserInfo>) => {
      state.user = action.payload;
      state.role = action.payload.role;
      state.isLoggedIn = true;
    },
    login: (state, action: PayloadAction<UserInfo>) => {
      state.user = action.payload;
      state.isLoggedIn = true;
      state.role = action.payload.role;
    },
    logout: (state) => {
      state.isLoggedIn = false;
      state.role = 'community';
      state.user = null;
    },
    setAuthChecked: (state, action: PayloadAction<boolean>) => {
      state.authChecked = action.payload;
    },
  },
});

export const { setRole, setIsLoggedIn, setUser, login, logout, setAuthChecked } = userSlice.actions;
export default userSlice.reducer;
