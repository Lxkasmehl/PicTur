/**
 * Per-IP sliding-window rate limiter with bounded in-memory state.
 * Evicts map keys when a bucket has no timestamps in the window (on access
 * and on a periodic sweep) so high-cardinality traffic cannot grow the Map forever.
 */
export function createInMemoryIpWindowRateLimiter(options: {
  windowMs: number;
  maxHits: number;
  /** How often to remove entries whose timestamps have all aged out (default 5m). */
  cleanupIntervalMs?: number;
}) {
  const { windowMs, maxHits, cleanupIntervalMs = 5 * 60 * 1000 } = options;
  const buckets = new Map<string, number[]>();
  let cleanupTimer: ReturnType<typeof setInterval> | undefined;

  function sweepStale(now: number) {
    const windowStart = now - windowMs;
    for (const [ip, hits] of buckets) {
      const fresh = hits.filter((t) => t > windowStart);
      if (fresh.length === 0) buckets.delete(ip);
      else if (fresh.length !== hits.length) buckets.set(ip, fresh);
    }
  }

  function ensureCleanupTimer() {
    if (cleanupTimer !== undefined) return;
    cleanupTimer = setInterval(() => sweepStale(Date.now()), cleanupIntervalMs);
    cleanupTimer.unref();
  }

  function rateLimitOk(ip: string): boolean {
    ensureCleanupTimer();
    const now = Date.now();
    const windowStart = now - windowMs;
    let hits = buckets.get(ip) || [];
    hits = hits.filter((t) => t > windowStart);
    if (hits.length === 0) buckets.delete(ip);
    if (hits.length >= maxHits) {
      buckets.set(ip, hits);
      return false;
    }
    hits.push(now);
    buckets.set(ip, hits);
    return true;
  }

  return { rateLimitOk };
}
