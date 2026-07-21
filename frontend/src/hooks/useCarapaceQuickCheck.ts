import { useCallback, useState } from 'react';
import { quickCheckCarapaceMatch } from '../services/api';
import type { QuickCheckMatch } from '../services/api';

export type QuickCheckStatus = 'idle' | 'running' | 'done' | 'error';

/**
 * State for the admin-only, read-only carapace quick check.
 *
 * `run` is the ONLY submit path in carapace mode — it never touches
 * localStorage, navigation, or the review queue, so no write path from the
 * normal upload flow is reachable while the mode is active.
 */
export function useCarapaceQuickCheck() {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<QuickCheckStatus>('idle');
  const [matches, setMatches] = useState<QuickCheckMatch[]>([]);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  // PR-4: true when a scoped member's quick check pulled in carapace refs outside
  // their assigned areas (the read-only flow writes nothing regardless, but the
  // banner tells them why distant turtles appear). Global users: always false.
  const [scopeExpanded, setScopeExpanded] = useState(false);

  const run = useCallback(async (file: File, matchSheet: string) => {
    setStatus('running');
    setError(null);
    setMatches([]);
    setElapsed(null);
    setSelectedIndex(null);
    setScopeExpanded(false);
    try {
      const response = await quickCheckCarapaceMatch(file, matchSheet);
      setMatches(response.matches ?? []);
      setElapsed(response.elapsed ?? null);
      setScopeExpanded(response.scope_expanded ?? false);
      setStatus('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Quick check failed.');
      setStatus('error');
    }
  }, []);

  const select = useCallback((index: number | null) => {
    setSelectedIndex(index);
  }, []);

  /** Full exit: clears results and turns carapace mode OFF (normal flow restored). */
  const reset = useCallback(() => {
    setEnabled(false);
    setStatus('idle');
    setMatches([]);
    setElapsed(null);
    setError(null);
    setSelectedIndex(null);
    setScopeExpanded(false);
  }, []);

  return {
    enabled,
    setEnabled,
    status,
    matches,
    elapsed,
    error,
    selectedIndex,
    scopeExpanded,
    run,
    select,
    reset,
  };
}
