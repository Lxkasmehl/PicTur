import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { listSheets } from '../../services/api';
import { setActiveOrg } from './orgSlice';

export const fetchAvailableSheets = createAsyncThunk(
  'availableSheets/fetch',
  async (_, { getState }) => {
    const state = getState() as { availableSheets?: { sheets: string[]; loading: boolean } };
    if (state.availableSheets?.sheets?.length) {
      return state.availableSheets.sheets;
    }
    const response = await listSheets();
    if (response.success && response.sheets?.length) {
      return response.sheets;
    }
    return [];
  },
);

interface AvailableSheetsState {
  sheets: string[];
  loading: boolean;
}

const initialState: AvailableSheetsState = {
  sheets: [],
  loading: false,
};

const availableSheetsSlice = createSlice({
  name: 'availableSheets',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      // tabs belong to a research group: forget them when the group changes
      .addCase(setActiveOrg, () => initialState)
      .addCase(fetchAvailableSheets.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchAvailableSheets.fulfilled, (state, action) => {
        state.sheets = action.payload;
        state.loading = false;
      })
      .addCase(fetchAvailableSheets.rejected, (state) => {
        state.sheets = [];
        state.loading = false;
      });
  },
});

export default availableSheetsSlice.reducer;
