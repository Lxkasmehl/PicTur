import type { AppDispatch } from './index';
import { setAllOrgs, setMyOrgs, setPublicOrgs } from './slices/orgSlice';
import { getMyOrgs, getPublicOrgs, listAllOrgs } from '../services/api/orgs';

/** Re-fetch memberships (after accepting an invitation, creating a group, ...). */
export async function refreshMyOrgs(dispatch: AppDispatch): Promise<void> {
  try {
    const res = await getMyOrgs();
    dispatch(setMyOrgs({ memberships: res.memberships, isSuperAdmin: res.is_super_admin }));
    dispatch(setAllOrgs(res.is_super_admin ? await listAllOrgs() : []));
  } catch {
    // keep previous state
  }
  try {
    dispatch(setPublicOrgs(await getPublicOrgs()));
  } catch {
    // keep previous state
  }
}
