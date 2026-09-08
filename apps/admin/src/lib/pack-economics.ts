import type { Schemas } from "./api";

/**
 * What a pack actually costs the viewer, per episode.
 *
 * The operator setting a price saw coins and rupees and nothing that connects them, so the number the viewer
 * decides on — what one episode ends up costing — was never on the screen where it gets set. Two consequences
 * were live in the seeded ladder and invisible from this table:
 *
 * - VIP at ₹299/30 days undercuts every coin pack, so anyone who does the arithmetic never buys coins again
 *   and anyone who does not pays roughly three times the effective rate. Either way it is a loss.
 * - A larger pack that is worse value than a smaller one inverts the ladder, and nothing flagged it.
 *
 * All of this is arithmetic over data the screen already has; none of it needs an endpoint.
 */

export type Pack = Schemas["AdminPackOut"];

export type PackEconomics = {
  currency: string;
  amount: number;
  /** Coins including bonus. */
  coins: number;
  episodes: number;
  /** Price of one episode bought through this pack. */
  perEpisode: number;
  bonusPct: number;
};

/** The headline price row: the base country (`*`) if there is one, else the first listed. */
export function basePrice(pack: Pack): Pack["prices"][number] | null {
  return pack.prices.find((p) => p.country === "*") ?? pack.prices[0] ?? null;
}

export function economics(pack: Pack, episodePrice: number): PackEconomics | null {
  const price = basePrice(pack);
  if (!price || pack.kind === "vip" || episodePrice <= 0) return null;
  const coins = pack.coins + pack.bonus_coins;
  const episodes = Math.floor(coins / episodePrice);
  if (episodes <= 0) return null;
  return {
    currency: price.currency,
    amount: price.amount,
    coins,
    episodes,
    perEpisode: price.amount / episodes,
    bonusPct: pack.coins > 0 ? Math.round((pack.bonus_coins / pack.coins) * 100) : 0,
  };
}

export type PackWarning = { kind: "vip_undercuts" | "inverted_ladder" | "no_price"; message: string };

/**
 * Problems visible only when the packs are compared with each other.
 *
 * Deliberately advisory: a promotional pack that is briefly poor value is a legitimate decision, so these
 * explain rather than block.
 */
export function warnings(pack: Pack, all: Pack[], episodePrice: number): PackWarning[] {
  const out: PackWarning[] = [];
  if (pack.is_active && pack.prices.length === 0) {
    out.push({ kind: "no_price", message: "Active with no price, so no client can offer it." });
  }

  const self = economics(pack, episodePrice);
  if (!self) return out;

  // A cheaper pack that buys episodes at a lower unit rate makes this one strictly worse value.
  const better = all
    .filter((p) => p.id !== pack.id && p.is_active)
    .map((p) => ({ p, e: economics(p, episodePrice) }))
    .find(({ p, e }) => e && e.currency === self.currency && e.amount < self.amount && e.perEpisode < self.perEpisode && p.coins < pack.coins);
  if (better?.e) {
    out.push({
      kind: "inverted_ladder",
      message: `Worse value than ${better.p.name}, which is cheaper and costs less per episode.`,
    });
  }

  // VIP is unlimited for its window, so the comparison is "episodes this pack buys" against "a month of them".
  const vip = all
    .filter((p) => p.kind === "vip" && p.is_active)
    .map((p) => ({ p, price: basePrice(p) }))
    .find(({ price }) => price && price.currency === self.currency);
  if (vip?.price && vip.price.amount < self.amount) {
    out.push({
      kind: "vip_undercuts",
      message: `${vip.p.name} costs less and unlocks everything, so this pack is dominated by it.`,
    });
  }
  return out;
}
