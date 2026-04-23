import { useCallback, useMemo, useRef } from "react";

const DEFAULT_STALE_THRESHOLD_MS = 1 * 60 * 1000; // 1 minute

export interface StreamLifecycleOptions {
  /** Time in ms after which a stream URL is considered stale. */
  staleThresholdMs?: number;
}

export interface StreamLifecycle {
  /** Call when stream sources are successfully fetched. */
  recordFetch: () => void;
  /** Whether the current URL is considered stale and should be refreshed. */
  shouldRefresh: () => boolean;
  /** Time elapsed since last fetch in ms; Infinity if never fetched. */
  ageMs: () => number;
}

export function useStreamLifecycle(options?: StreamLifecycleOptions): StreamLifecycle {
  const threshold = options?.staleThresholdMs ?? DEFAULT_STALE_THRESHOLD_MS;
  const lastFetchTimeRef = useRef<number>(0);

  const recordFetch = useCallback(() => {
    lastFetchTimeRef.current = Date.now();
  }, []);

  const ageMs = useCallback(() => {
    const last = lastFetchTimeRef.current;
    if (last === 0) return Infinity;
    return Date.now() - last;
  }, []);

  const shouldRefresh = useCallback(() => {
    return ageMs() > threshold;
  }, [ageMs, threshold]);

  return useMemo(
    () => ({ recordFetch, shouldRefresh, ageMs }),
    [recordFetch, shouldRefresh, ageMs],
  );
}
