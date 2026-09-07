/**
 * Ad placements: **local stub, no API yet.**
 *
 * `/v1/admin/ad-placements` does not exist (see docs/frontend-gaps.md → "admin (tranche 1)").
 * The page is built against these types and an in-memory store so the UI is ready the day the
 * endpoints land; until then `/ads` is hidden from the sidebar (`hidden: true` in lib/nav.ts).
 *
 * To switch to the real API: delete the store below, keep the types (they mirror the proposed
 * `AdPlacementIn`/`AdPlacementOut`), and replace each `stub*` call with the generated client.
 */

export const AD_SLOTS = ["home_rail", "player_pre", "player_mid", "unlock_rewarded", "paywall"] as const;
export type AdSlot = (typeof AD_SLOTS)[number];

export const AD_PROVIDERS = ["admob", "meta", "house"] as const;
export type AdProvider = (typeof AD_PROVIDERS)[number];

export const AD_PLATFORMS = ["android", "ios", "web"] as const;
export type AdPlatform = (typeof AD_PLATFORMS)[number];

export type AdPlacementIn = {
  name: string;
  slot: AdSlot;
  provider: AdProvider;
  /** Provider-side unit id (AdMob ad unit, Meta placement id, or a house campaign slug). */
  unit_id: string;
  platforms: AdPlatform[];
  /** Coins granted for a completed rewarded view; null for non-rewarded slots. */
  reward_coins: number | null;
  /** Minimum seconds between two impressions of this placement for one viewer. */
  frequency_cap_sec: number;
  is_active: boolean;
  sort_order: number;
};

export type AdPlacement = AdPlacementIn & {
  id: string;
  created_at: string;
  updated_at: string;
};

export const SLOT_LABEL: Record<AdSlot, string> = {
  home_rail: "Home rail banner",
  player_pre: "Player pre-roll",
  player_mid: "Player mid-roll",
  unlock_rewarded: "Rewarded unlock",
  paywall: "Paywall banner",
};

export const PROVIDER_LABEL: Record<AdProvider, string> = {
  admob: "Google AdMob",
  meta: "Meta Audience Network",
  house: "House ad",
};

/** Rewarded slots are the only ones where reward_coins is meaningful. */
export function isRewardedSlot(slot: AdSlot): boolean {
  return slot === "unlock_rewarded";
}

/* ---------- in-memory stub store ---------- */

const SEED: AdPlacement[] = [
  {
    id: "stub-1",
    name: "Rewarded unlock (Android)",
    slot: "unlock_rewarded",
    provider: "admob",
    unit_id: "ca-app-pub-0000000000000000/1111111111",
    platforms: ["android"],
    reward_coins: 10,
    frequency_cap_sec: 300,
    is_active: false,
    sort_order: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

let store: AdPlacement[] = [...SEED];
let seq = 1;

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), 150));
}

export function stubList(): Promise<AdPlacement[]> {
  return delay([...store].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)));
}

export function stubCreate(body: AdPlacementIn): Promise<AdPlacement> {
  const now = new Date().toISOString();
  const created: AdPlacement = { ...body, id: `stub-${++seq}-${Date.now()}`, created_at: now, updated_at: now };
  store = [...store, created];
  return delay(created);
}

export function stubUpdate(id: string, body: AdPlacementIn): Promise<AdPlacement> {
  const existing = store.find((p) => p.id === id);
  if (!existing) return Promise.reject(new Error("Placement not found"));
  const saved: AdPlacement = { ...existing, ...body, updated_at: new Date().toISOString() };
  store = store.map((p) => (p.id === id ? saved : p));
  return delay(saved);
}

export function stubDelete(id: string): Promise<void> {
  store = store.filter((p) => p.id !== id);
  return delay(undefined);
}
