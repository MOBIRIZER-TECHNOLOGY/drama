import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/errors";

export type QueryState<T> = {
  data: T | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refetch: (opts?: { silent?: boolean }) => Promise<void>;
  setData: (updater: T | ((prev: T | null) => T | null)) => void;
};

/**
 * Minimal async data hook: runs `fetcher` when `deps` change, exposes loading/refreshing/error and a refetch.
 * `enabled: false` skips the fetch (e.g. guest users on authenticated endpoints).
 */
export function useQuery<T>(fetcher: () => Promise<T>, deps: readonly unknown[], opts?: { enabled?: boolean }): QueryState<T> {
  const enabled = opts?.enabled ?? true;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetcherRef = useRef(fetcher);
  const runId = useRef(0);

  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const run = useCallback(async (silent: boolean) => {
    const id = ++runId.current;
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const result = await fetcherRef.current();
      if (id === runId.current) setData(result);
    } catch (e) {
      if (id === runId.current) setError(errorMessage(e));
    } finally {
      if (id === runId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      runId.current++;
      return;
    }
    // Kick off in a microtask so the loading flip is not a synchronous setState inside the effect.
    void Promise.resolve().then(() => run(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, run, ...deps]);

  const refetch = useCallback((o?: { silent?: boolean }) => run(o?.silent ?? true), [run]);
  const set = useCallback((updater: T | ((prev: T | null) => T | null)) => {
    setData((prev) => (typeof updater === "function" ? (updater as (p: T | null) => T | null)(prev) : updater));
  }, []);

  // While disabled (e.g. guest on an authenticated endpoint) expose an idle, empty state without touching state.
  if (!enabled) return { data: null, loading: false, refreshing: false, error: null, refetch, setData: set };
  return { data, loading, refreshing, error, refetch, setData: set };
}
