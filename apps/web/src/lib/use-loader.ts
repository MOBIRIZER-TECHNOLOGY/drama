import { useEffect } from "react";

/**
 * Runs an async loader on mount and whenever the (memoised) loader changes.
 * Loaders must only set state after their first `await` so the effect body itself stays pure.
 */
export function useLoader(load: () => Promise<unknown>): void {
  useEffect(() => {
    void load();
  }, [load]);
}
