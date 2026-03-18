import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { fetchAvailableSheets } from '../store/slices/availableSheetsSlice';
import { getToken } from '../services/api';

/**
 * Ensures available sheets (locations/datasheets) are loaded when user is staff or admin.
 * Use in admin pages or components that need the sheets list.
 * Only fetches when role is staff or admin and a token is present to avoid 401 on unauthenticated requests.
 */
export function useAvailableSheets(role: string | undefined) {
  const dispatch = useAppDispatch();
  const { sheets, loading } = useAppSelector((state) => state.availableSheets);

  useEffect(() => {
    if ((role === 'staff' || role === 'admin') && getToken()) {
      dispatch(fetchAvailableSheets());
    }
  }, [role, dispatch]);

  return { sheets, loading };
}
