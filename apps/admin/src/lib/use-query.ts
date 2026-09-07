"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "./api";

type Result<T> = { key: string; data?: T; error?: string };

/**
 * Minimal client-side fetch hook. `key` identifies the request (change it to refetch with new
 * params); previous data is kept while the next request is in flight so tables don't flash.
 */
export function useQuery<T>(key: string, fn: () => Promise<T>) {
  const [result, setResult] = useState<Result<T>>({ key: "" });
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });

  const current = `${key}#${tick}`;
  useEffect(() => {
    let cancelled = false;
    fnRef.current().then(
      (data) => {
        if (!cancelled) setResult({ key: current, data });
      },
      (err: unknown) => {
        if (!cancelled) setResult((prev) => ({ key: current, data: prev.data, error: errorMessage(err) }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [current]);

  const refetch = useCallback(() => setTick((t) => t + 1), []);
  const setData = useCallback((updater: T | ((prev: T | undefined) => T)) => {
    setResult((prev) => ({
      ...prev,
      data: typeof updater === "function" ? (updater as (p: T | undefined) => T)(prev.data) : updater,
    }));
  }, []);

  const settled = result.key === current;
  return {
    data: result.data,
    error: settled ? result.error : undefined,
    loading: !settled,
    refetch,
    setData,
  };
}
