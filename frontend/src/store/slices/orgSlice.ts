import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { Membership, PublicOrg } from '../../services/api/orgs';
import { MAIN_ORG_SLUG } from '../../services/api/orgContext';

export { MAIN_ORG_SLUG };
const ACTIVE_ORG_KEY = 'active_org';

function readActiveSlug(): string {
  try {
    return localStorage.getItem(ACTIVE_ORG_KEY) || MAIN_ORG_SLUG;
  } catch {
    return MAIN_ORG_SLUG;
  }
}

interface OrgState {
  /** Groups of the logged-in user (main group first). Empty when logged out. */
  memberships: Membership[];
  /** Groups accepting community uploads (visible to everyone). */
  publicOrgs: PublicOrg[];
  /** Super admins only: every group on the platform. */
  allOrgs: PublicOrg[];
  isSuperAdmin: boolean;
  /** Currently selected research group (persisted per browser). */
  activeSlug: string;
  loaded: boolean;
  /** True once the public group list has been fetched (or failed). */
  publicLoaded: boolean;
}

const initialState: OrgState = {
  memberships: [],
  publicOrgs: [],
  allOrgs: [],
  isSuperAdmin: false,
  activeSlug: readActiveSlug(),
  loaded: false,
  publicLoaded: false,
};

const orgSlice = createSlice({
  name: 'org',
  initialState,
  reducers: {
    setMyOrgs: (state, action: PayloadAction<{ memberships: Membership[]; isSuperAdmin: boolean }>) => {
      state.memberships = action.payload.memberships;
      state.isSuperAdmin = action.payload.isSuperAdmin;
    },
    setPublicOrgs: (state, action: PayloadAction<PublicOrg[]>) => {
      state.publicOrgs = action.payload;
      state.publicLoaded = true;
    },
    setAllOrgs: (state, action: PayloadAction<PublicOrg[]>) => {
      state.allOrgs = action.payload;
    },
    setOrgsLoaded: (state, action: PayloadAction<boolean>) => {
      state.loaded = action.payload;
    },
    setActiveOrg: (state, action: PayloadAction<string>) => {
      state.activeSlug = action.payload;
      try {
        localStorage.setItem(ACTIVE_ORG_KEY, action.payload);
      } catch {
        // storage unavailable (private mode); keep in memory only
      }
    },
    clearMyOrgs: (state) => {
      state.memberships = [];
      state.allOrgs = [];
      state.isSuperAdmin = false;
    },
  },
});

export const { setMyOrgs, setPublicOrgs, setAllOrgs, setOrgsLoaded, setActiveOrg, clearMyOrgs } = orgSlice.actions;
export default orgSlice.reducer;
