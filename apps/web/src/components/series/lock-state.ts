import type { EpisodeOut } from "@/lib/types";

export type LockState = "free" | "accessible" | "next" | "later";

export function highestAccessibleNumber(episodes: EpisodeOut[]): number {
  return episodes.reduce((max, e) => (e.accessible || e.is_free ? Math.max(max, e.number) : max), 0);
}

/** Sequential unlock: only `highest accessible + 1` can be unlocked right now. */
export function lockState(ep: EpisodeOut, highest: number): LockState {
  if (ep.is_free) return "free";
  if (ep.accessible) return "accessible";
  if (ep.number === highest + 1) return "next";
  return "later";
}
