import { useEffect } from 'react';
import { useActiveOrg } from '../hooks/useActiveOrg';
import { MAIN_ORG_SLUG, setActiveOrg } from '../store/slices/orgSlice';
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

  // A remembered group that is no longer available (left the group, logged out, closed for the
  // community) falls back to the main group.
  const { options, loaded } = useActiveOrg();
  const { activeSlug, publicLoaded } = useAppSelector((s) => s.org);
  useEffect(() => {
    if (loaded && publicLoaded && activeSlug !== MAIN_ORG_SLUG && !options.some((o) => o.slug === activeSlug)) {
      dispatch(setActiveOrg(MAIN_ORG_SLUG));
    }
  }, [loaded, publicLoaded, activeSlug, options, dispatch]);

  return <>{children}</>;
}
