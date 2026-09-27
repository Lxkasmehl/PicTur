import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { clearMyOrgs, setAllOrgs, setMyOrgs, setOrgsLoaded, setPublicOrgs } from '../store/slices/orgSlice';
import { getMyOrgs, getPublicOrgs, listAllOrgs } from '../services/api/orgs';

/** Loads the public research groups and, when logged in, the user's memberships. */
export default function OrgProvider({ children }: { children: React.ReactNode }) {
  const dispatch = useAppDispatch();
  const { isLoggedIn, authChecked, user } = useAppSelector((s) => s.user);

  useEffect(() => {
    getPublicOrgs()
      .then((orgs) => dispatch(setPublicOrgs(orgs)))
      .catch(() => dispatch(setPublicOrgs([])));
  }, [dispatch]);

  useEffect(() => {
    if (!authChecked) return;
    let cancelled = false;
    if (!isLoggedIn) {
      dispatch(clearMyOrgs());
      dispatch(setOrgsLoaded(true));
      return;
    }
    dispatch(setOrgsLoaded(false));
    getMyOrgs()
      .then(async (res) => {
        const all = res.is_super_admin ? await listAllOrgs().catch(() => []) : [];
        if (!cancelled) {
          dispatch(setMyOrgs({ memberships: res.memberships, isSuperAdmin: res.is_super_admin }));
          dispatch(setAllOrgs(all));
        }
      })
      .catch(() => {
        if (!cancelled) dispatch(clearMyOrgs());
      })
      .finally(() => {
        if (!cancelled) dispatch(setOrgsLoaded(true));
      });
    return () => {
      cancelled = true;
    };
  }, [dispatch, authChecked, isLoggedIn, user?.id]);

  return <>{children}</>;
}
