import { describe, expect, it } from "vitest";
import { basePrice, economics, warnings, type Pack } from "./pack-economics";

function pack(over: Partial<Pack> & Record<string, unknown>): Pack {
  return { id: "p", name: "Pack", kind: "coins", coins: 100, bonus_coins: 0, is_active: true, prices: [{ country: "*", currency: "INR", amount: 100 }], ...over } as unknown as Pack;
}

describe("basePrice", () => {
  it("prefers the * row, then the first, else null", () => {
    const a = { country: "IN", currency: "INR", amount: 1 };
    const b = { country: "*", currency: "USD", amount: 2 };
    expect(basePrice(pack({ prices: [a, b] } as never))).toBe(b);
    expect(basePrice(pack({ prices: [a] } as never))).toBe(a);
    expect(basePrice(pack({ prices: [] }))).toBeNull();
  });
});

describe("economics", () => {
  it("computes per-episode cost and bonus percentage", () => {
    expect(economics(pack({ coins: 100, bonus_coins: 20 }), 10)).toEqual({ currency: "INR", amount: 100, coins: 120, episodes: 12, perEpisode: 100 / 12, bonusPct: 20 });
  });
  it("is null for vip, no price, free episodes or too few coins", () => {
    expect(economics(pack({ kind: "vip" }), 10)).toBeNull();
    expect(economics(pack({ prices: [] }), 10)).toBeNull();
    expect(economics(pack({}), 0)).toBeNull();
    expect(economics(pack({ coins: 5 }), 10)).toBeNull();
  });
  it("reports 0% bonus when the pack has no base coins", () => {
    expect(economics(pack({ coins: 0, bonus_coins: 50 }), 10)?.bonusPct).toBe(0);
  });
});

describe("warnings", () => {
  it("flags an active pack with no price", () => {
    expect(warnings(pack({ prices: [] }), [], 10).map((w) => w.kind)).toEqual(["no_price"]);
    expect(warnings(pack({ prices: [], is_active: false }), [], 10)).toEqual([]);
  });
  it("flags an inverted ladder against a cheaper, better, smaller pack", () => {
    const small = pack({ id: "s", name: "Small", coins: 100, prices: [{ country: "*", currency: "INR", amount: 50 }] } as never);
    const big = pack({ id: "b", name: "Big", coins: 200, prices: [{ country: "*", currency: "INR", amount: 150 }] } as never);
    const w = warnings(big, [small, big], 10);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ kind: "inverted_ladder" });
    expect(w[0].message).toContain("Small");
    expect(warnings(small, [small, big], 10)).toEqual([]);
  });
  it("ignores inactive or other-currency comparisons", () => {
    const small = pack({ id: "s", is_active: false, prices: [{ country: "*", currency: "INR", amount: 1 }] } as never);
    const usd = pack({ id: "u", prices: [{ country: "*", currency: "USD", amount: 1 }] } as never);
    const big = pack({ id: "b", coins: 200 });
    expect(warnings(big, [small, usd, big], 10)).toEqual([]);
  });
  it("flags a cheaper VIP in the same currency", () => {
    const vip = pack({ id: "v", kind: "vip", name: "VIP", prices: [{ country: "*", currency: "INR", amount: 50 }] } as never);
    const p = pack({});
    expect(warnings(p, [vip, p], 10).map((w) => w.kind)).toEqual(["vip_undercuts"]);
    const dearVip = pack({ id: "v", kind: "vip", prices: [{ country: "*", currency: "INR", amount: 500 }] } as never);
    expect(warnings(p, [dearVip, p], 10)).toEqual([]);
    const usdVip = pack({ id: "v", kind: "vip", prices: [{ country: "*", currency: "USD", amount: 1 }] } as never);
    expect(warnings(p, [usdVip, p], 10)).toEqual([]);
    const noPriceVip = pack({ id: "v", kind: "vip", prices: [] });
    expect(warnings(p, [noPriceVip, p], 10)).toEqual([]);
  });
});
