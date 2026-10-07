import { useEffect, useState } from 'react';
import { useActiveOrg } from './useActiveOrg';
import { isStaffRole } from '../services/api/auth';
import {
  getLocationStructure,
  type LocationStructure,
  type LocationStructureResponse,
} from '../services/api/general-locations';

export interface LocationStructureInfo {
  structure: LocationStructure;
  /** The group's only program when structure is single / areas (forms select it silently). */
  program: string | null;
  /** Its fixed General Location when structure is single. */
  generalLocation: string | null;
  loaded: boolean;
}

const PROGRAMS: LocationStructureInfo = { structure: 'programs', program: null, generalLocation: null, loaded: true };

// One request per group; the Locations page publishes changes so open forms follow.
const cache = new Map<string, Promise<LocationStructureInfo>>();
const listeners = new Set<(slug: string, info: LocationStructureInfo) => void>();

function toInfo(res: LocationStructureResponse): LocationStructureInfo {
  return { structure: res.structure, program: res.program, generalLocation: res.general_location, loaded: true };
}

/** Called after the structure (or the group's programs) changed. */
export function publishLocationStructure(slug: string, res: LocationStructureResponse): void {
  const info = toInfo(res);
  cache.set(slug, Promise.resolve(info));
  listeners.forEach((l) => l(slug, info));
}

/**
 * How the active research group structures locations. The main group always uses programs
 * (Google Sheets tabs); community visitors never see the location fields, so they skip the request.
 */
export function useLocationStructure(): LocationStructureInfo {
  const { active, isDbOrg, role, ready } = useActiveOrg();
  const enabled = isDbOrg && ready && isStaffRole(role);
  const slug = active.slug;
  const [state, setState] = useState<{ slug: string; info: LocationStructureInfo } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let request = cache.get(slug);
    if (!request) {
      request = getLocationStructure().then(toInfo, () => PROGRAMS);
      cache.set(slug, request);
    }
    request.then((info) => {
      if (!cancelled) setState({ slug, info });
    });
    const listener = (changed: string, info: LocationStructureInfo) => {
      if (changed === slug) setState({ slug, info });
    };
    listeners.add(listener);
    return () => {
      cancelled = true;
      listeners.delete(listener);
    };
  }, [enabled, slug]);

  if (!isDbOrg) return PROGRAMS;
  if (!enabled || state?.slug !== slug) return { ...PROGRAMS, loaded: false };
  return state.info;
}
