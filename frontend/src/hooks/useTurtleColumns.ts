import { useEffect, useState } from 'react';
import { useActiveOrg } from './useActiveOrg';
import { isStaffRole } from '../services/api/auth';
import { getTurtleColumns, type CustomColumn, type TurtleColumnsResponse } from '../services/api/turtleColumns';

export interface TurtleColumnsInfo {
  /** Standard field keys the group uses; null = every field (main group, or not loaded). */
  enabled: Set<string> | null;
  /** The group's own columns, in order. */
  custom: CustomColumn[];
  loaded: boolean;
}

const ALL: TurtleColumnsInfo = { enabled: null, custom: [], loaded: true };

// One request per group; the settings page publishes changes so open forms follow.
const cache = new Map<string, Promise<TurtleColumnsInfo>>();
const listeners = new Set<(slug: string, info: TurtleColumnsInfo) => void>();

function toInfo(res: TurtleColumnsResponse): TurtleColumnsInfo {
  if (!res.configurable) return ALL;
  return { enabled: new Set(res.standard.filter((c) => c.enabled).map((c) => c.key)), custom: res.custom, loaded: true };
}

/** Called after a group's columns changed. */
export function publishTurtleColumns(slug: string, res: TurtleColumnsResponse): void {
  const info = toInfo(res);
  cache.set(slug, Promise.resolve(info));
  listeners.forEach((l) => l(slug, info));
}

/**
 * Turtle data columns of the active research group. The main group has every standard field and
 * no custom ones; community visitors never see the data form, so they skip the request.
 */
export function useTurtleColumns(): TurtleColumnsInfo {
  const { active, isDbOrg, role, ready } = useActiveOrg();
  const enabled = isDbOrg && ready && isStaffRole(role);
  const slug = active.slug;
  const [state, setState] = useState<{ slug: string; info: TurtleColumnsInfo } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let request = cache.get(slug);
    if (!request) {
      request = getTurtleColumns().then(toInfo, () => ALL);
      cache.set(slug, request);
    }
    request.then((info) => {
      if (!cancelled) setState({ slug, info });
    });
    const listener = (changed: string, info: TurtleColumnsInfo) => {
      if (changed === slug) setState({ slug, info });
    };
    listeners.add(listener);
    return () => {
      cancelled = true;
      listeners.delete(listener);
    };
  }, [enabled, slug]);

  if (!isDbOrg) return ALL;
  if (!enabled || state?.slug !== slug) return { ...ALL, loaded: false };
  return state.info;
}
