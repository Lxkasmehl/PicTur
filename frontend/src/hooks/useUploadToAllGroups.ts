import { useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { setUploadToAllGroups } from '../store/slices/orgSlice';
import { useActiveOrg } from './useActiveOrg';

/**
 * Community members who do not know which research group a turtle belongs to can send the photo
 * to every group that accepts community photos; each group reviews its own copy.
 * Only offered to visitors (community role) and only when at least two groups accept photos.
 */
export function useUploadToAllGroups() {
  const dispatch = useAppDispatch();
  const { role } = useActiveOrg();
  const { publicOrgs, uploadToAllGroups } = useAppSelector((s) => s.org);
  const available = role === 'community' && publicOrgs.length >= 2;
  const setEnabled = useCallback((value: boolean) => dispatch(setUploadToAllGroups(value)), [dispatch]);
  return { available, enabled: available && uploadToAllGroups, groupCount: publicOrgs.length, setEnabled };
}
