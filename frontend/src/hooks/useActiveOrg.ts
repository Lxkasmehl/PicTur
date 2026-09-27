import { useCallback, useMemo } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { MAIN_ORG_SLUG, setActiveOrg } from '../store/slices/orgSlice';
import type { OrgKind } from '../services/api/orgs';
import type { UserRole } from '../types/User';

export interface OrgOption {
  /** Organization id in the auth backend (0 until the group list has loaded). */
  id: number;
  slug: string;
  name: string;
  kind: OrgKind;
  /** The user's role in this group ('community' when only visiting). */
  role: UserRole;
  isMember: boolean;
}

/**
 * The currently selected research group and the user's role in it.
 *
 * The main (Sheets) group keeps using users.role exactly as before; database-backed groups use
 * the membership role (super admins act as admin everywhere).
 */
export function useActiveOrg() {
  const dispatch = useAppDispatch();
  const { memberships, publicOrgs, allOrgs, isSuperAdmin, activeSlug, loaded, publicLoaded } =
    useAppSelector((s) => s.org);
  const { role: mainRole } = useAppSelector((s) => s.user);

  /** Every group the user can switch to: own memberships plus groups open to the community. */
  const options = useMemo<OrgOption[]>(() => {
    const out = new Map<string, OrgOption>();
    for (const m of memberships) {
      out.set(m.slug, {
        id: m.org_id,
        slug: m.slug,
        name: m.name,
        kind: m.kind,
        role: m.slug === MAIN_ORG_SLUG ? mainRole : isSuperAdmin ? 'admin' : m.role,
        isMember: true,
      });
    }
    for (const o of [...publicOrgs, ...allOrgs]) {
      if (out.has(o.slug)) continue;
      out.set(o.slug, {
        id: o.id,
        slug: o.slug,
        name: o.name,
        kind: o.kind,
        role: o.slug === MAIN_ORG_SLUG ? mainRole : isSuperAdmin ? 'admin' : 'community',
        isMember: o.slug === MAIN_ORG_SLUG,
      });
    }
    if (!out.has(MAIN_ORG_SLUG)) {
      out.set(MAIN_ORG_SLUG, { id: 0, slug: MAIN_ORG_SLUG, name: 'PicTur', kind: 'sheets', role: mainRole, isMember: true });
    }
    const list = [...out.values()];
    return [
      ...list.filter((o) => o.slug === MAIN_ORG_SLUG),
      ...list.filter((o) => o.slug !== MAIN_ORG_SLUG).sort((a, b) => a.name.localeCompare(b.name)),
    ];
  }, [memberships, publicOrgs, allOrgs, isSuperAdmin, mainRole]);

  const active = options.find((o) => o.slug === activeSlug) ?? options[0];
  /** False while a remembered research group is still being resolved (its role is not known yet).
   * Pages must not redirect on role before this is true. Always true for the main group. */
  const ready = activeSlug === MAIN_ORG_SLUG || active.slug === activeSlug || (loaded && publicLoaded);
  const isDbOrg = active.kind === 'db';

  const select = useCallback((slug: string) => dispatch(setActiveOrg(slug)), [dispatch]);

  return {
    active,
    /** Role that drives navigation, theme and page guards for the selected group. */
    role: active.role,
    isDbOrg,
    options,
    isSuperAdmin,
    loaded,
    ready,
    select,
  };
}

/** Membership lookup for a specific group (e.g. from a /g/:slug URL). */
export function useOrgBySlug(slug: string | undefined) {
  const { options, isSuperAdmin, loaded } = useActiveOrg();
  const org = options.find((o) => o.slug === slug);
  return { org, isSuperAdmin, loaded };
}
