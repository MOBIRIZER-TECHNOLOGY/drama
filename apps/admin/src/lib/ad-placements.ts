import type { Schemas } from "./api";

/**
 * Ad placement vocabulary.
 *
 * This module used to carry an in-memory store because `/v1/admin/ad-placements` did not exist, so everything
 * the screen configured was lost on reload. The endpoints exist now; what remains here is the labelling the API
 * deliberately does not own — a slot is `unlock_rewarded` on the wire and "Rewarded unlock" to a person.
 *
 * The literal unions mirror the API's validators. Keeping them in step is the point: the server rejects an
 * unknown slot, and this list is what stops the console offering one.
 */

export type AdPlacement = Schemas["AdPlacementOut"];
export type AdPlacementIn = Schemas["AdPlacementIn"];

export const AD_SLOTS = ["home_rail", "player_pre", "player_mid", "unlock_rewarded", "paywall"] as const;
export type AdSlot = (typeof AD_SLOTS)[number];

export const AD_PROVIDERS = ["admob", "meta", "house"] as const;
export type AdProvider = (typeof AD_PROVIDERS)[number];

export const AD_PLATFORMS = ["android", "ios", "web"] as const;
export type AdPlatform = (typeof AD_PLATFORMS)[number];

export const SLOT_LABEL: Record<string, string> = {
  home_rail: "Home rail banner",
  player_pre: "Player pre-roll",
  player_mid: "Player mid-roll",
  unlock_rewarded: "Rewarded unlock",
  paywall: "Paywall banner",
};

export const PROVIDER_LABEL: Record<string, string> = {
  admob: "Google AdMob",
  meta: "Meta Audience Network",
  house: "House ad",
};

/**
 * Rewarded slots are the only ones where `reward_coins` means anything.
 *
 * The API enforces this too — it stores NULL on every other slot — because otherwise a value left behind by
 * changing the slot in the form becomes a payout nobody intended.
 */
export function isRewardedSlot(slot: string): boolean {
  return slot === "unlock_rewarded";
}
