import { getJson, setJson } from "./storage";

/**
 * Holds a deep link that arrived before the app could act on it.
 *
 * On a fresh install `Stack.Protected guard={!onboarded}` renders onboarding and the incoming route is
 * discarded, so a viewer who tapped a friend's link completes three onboarding pages and lands on Home, never
 * seeing the series they were sent. Which is the exact moment a share is worth the most.
 *
 * The route is parked here on arrival and honoured once onboarding finishes. It also carries the campaign
 * parameters, so attribution survives the detour.
 */

export type PendingRoute = {
  pathname: string;
  params?: Record<string, string>;
  /** Milliseconds since epoch. A link is only worth honouring while the intent behind it is still fresh. */
  at: number;
};

const KEY = "pendingRoute";
const MAX_AGE_MS = 30 * 60 * 1000;

export async function stashRoute(pathname: string, params?: Record<string, string>): Promise<void> {
  await setJson(KEY, { pathname, params, at: Date.now() } satisfies PendingRoute);
}

/** Read and clear. Returns null when there is nothing waiting, or what was waiting has gone stale. */
export async function takeRoute(): Promise<PendingRoute | null> {
  const stored = await getJson<PendingRoute>(KEY);
  await setJson(KEY, null);
  if (!stored?.pathname) return null;
  if (Date.now() - (stored.at ?? 0) > MAX_AGE_MS) return null;
  return stored;
}
