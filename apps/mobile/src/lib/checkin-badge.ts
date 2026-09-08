import { api } from "./api";

/**
 * Whether today's check-in is still unclaimed.
 *
 * The daily habit had no visual pull anywhere in the app: the streak lives two taps deep behind the Me tab, so
 * a viewer who wanted to keep it had to remember it unprompted — which is the same as not having one. This is
 * the single piece of state the tab bar needs to put a dot on that path.
 *
 * A module-level store rather than context: the tab bar, the Me screen and the rewards screen all read and
 * write it, and none of them are ancestors of the others.
 */
let unclaimed = false;
const listeners = new Set<() => void>();

function set(next: boolean): void {
  if (next === unclaimed) return;
  unclaimed = next;
  for (const l of listeners) l();
}

export function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export function getSnapshot(): boolean {
  return unclaimed;
}

/** Signed out, or rewards switched off in remote config, means no dot. */
export async function refresh(enabled: boolean): Promise<void> {
  if (!enabled) {
    set(false);
    return;
  }
  try {
    const { data } = await api.GET("/v1/rewards/checkin");
    if (data) set(!data.checked_in_today);
  } catch {
    // A failed poll leaves the badge as it was; it is a nudge, not a source of truth.
  }
}

/** Called by the rewards screen the moment a claim lands, so the dot clears without waiting for a poll. */
export function markClaimed(): void {
  set(false);
}
