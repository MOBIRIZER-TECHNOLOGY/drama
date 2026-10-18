import { describe, expect, it } from "vitest";
import { AD_SLOTS, PROVIDER_LABEL, SLOT_LABEL, isRewardedSlot } from "./ad-placements";
import { ADULT_RATINGS, CONTENT_RATINGS } from "./ratings";
import { seriesTitle } from "./series";
import { checkPlaceholders, describeProblem, placeholders, tooLong } from "./placeholders";
import { fmtCompact, fmtDate, fmtDateTime, fmtMoney, fmtNumber, fromLocalInput, shortId, slugify, toLocalInput } from "./format";
import { SETTINGS_SCHEMA, coerce, specFor, validate } from "./settings-schema";

describe("ad placements", () => {
  it("labels every slot and only rewarded slots carry coins", () => {
    for (const s of AD_SLOTS) expect(SLOT_LABEL[s]).toBeTruthy();
    expect(PROVIDER_LABEL.admob).toBe("Google AdMob");
    expect(isRewardedSlot("unlock_rewarded")).toBe(true);
    expect(isRewardedSlot("paywall")).toBe(false);
  });
});

describe("ratings", () => {
  it("flags A and UA16 as adult", () => {
    expect(CONTENT_RATINGS.map((r) => r.value)).toContain("UA13");
    expect([...ADULT_RATINGS].sort()).toEqual(["A", "UA16"]);
  });
});

describe("seriesTitle", () => {
  const t = (lang: string, title: string) => ({ lang, title }) as never;
  it("prefers original language, then English, then first, then slug", () => {
    expect(seriesTitle({ slug: "s", original_language: "hi", translations: [t("en", "E"), t("hi", "H")] })).toBe("H");
    expect(seriesTitle({ slug: "s", original_language: "ta", translations: [t("fr", "F"), t("en", "E")] })).toBe("E");
    expect(seriesTitle({ slug: "s", original_language: "ta", translations: [t("fr", "F")] })).toBe("F");
    expect(seriesTitle({ slug: "slug", original_language: "ta", translations: [] })).toBe("slug");
  });
});

describe("placeholders", () => {
  it("extracts lowercased token names", () => {
    expect([...placeholders("Hi {Name}, {count} left {name}")].sort()).toEqual(["count", "name"]);
  });
  it("accepts reordered/repeated tokens and empty translations", () => {
    expect(checkPlaceholders("{a} then {b}", "{b} {b} {a}")).toBeNull();
    expect(checkPlaceholders("{a}", "   ")).toBeNull();
  });
  it("reports missing and unexpected tokens", () => {
    const p = checkPlaceholders("{a} {b}", "{a} {c}");
    expect(p).toEqual({ missing: ["b"], unexpected: ["c"] });
    expect(describeProblem(p!)).toBe("missing {b}; unknown {c}");
    expect(describeProblem({ missing: ["x"], unexpected: [] })).toBe("missing {x}");
    expect(describeProblem({ missing: [], unexpected: ["y"] })).toBe("unknown {y}");
  });
  it("flags translations far longer than the source", () => {
    expect(tooLong("Play", "x".repeat(24))).toBe(false);
    expect(tooLong("Play", "x".repeat(25))).toBe(true);
    expect(tooLong("", "x".repeat(100))).toBe(false);
    expect(tooLong("a".repeat(100), "x".repeat(200))).toBe(false);
  });
});

describe("format", () => {
  it("handles empty and invalid dates", () => {
    for (const f of [fmtDate, fmtDateTime, toLocalInput]) {
      expect(f(null)).toBe(f === toLocalInput ? "" : "—");
      expect(f("nope")).toBe(f === toLocalInput ? "" : "—");
    }
    expect(fmtDate("2025-03-04T10:00:00Z")).toMatch(/04 Mar 2025/);
    expect(fmtDateTime("2025-03-04T10:00:00Z")).toMatch(/Mar 2025/);
  });
  it("formats numbers", () => {
    expect(fmtNumber(null)).toBe("—");
    expect(fmtNumber(1234567)).toBe("1,234,567");
    expect(fmtCompact(undefined)).toBe("—");
    expect(fmtCompact(1500)).toBe("1.5K");
  });
  it("formats money, falling back for unknown currencies", () => {
    expect(fmtMoney(5, "USD")).toBe("$5.00");
    expect(fmtMoney(5, "not-a-code")).toBe("not-a-code 5.00");
  });
  it("round-trips datetime-local values", () => {
    const iso = new Date(2025, 0, 2, 3, 4).toISOString();
    expect(toLocalInput(iso)).toBe("2025-01-02T03:04");
    expect(fromLocalInput("2025-01-02T03:04")).toBe(iso);
    expect(fromLocalInput("")).toBeNull();
    expect(fromLocalInput("garbage")).toBeNull();
  });
  it("slugifies and shortens", () => {
    expect(slugify("  Café Ünïcode -- Drama!! ")).toBe("cafe-unicode-drama");
    expect(slugify("a".repeat(200))).toHaveLength(160);
    expect(shortId("abcdefghijklmnop")).toBe("abcdefgh…");
    expect(shortId("short")).toBe("short");
  });
});

describe("settings schema", () => {
  it("looks up specs", () => {
    expect(specFor("economy", "episode_price")?.unit).toBe("coins");
    expect(specFor("economy", "nope")).toBeNull();
    expect(specFor("nope", "x")).toBeNull();
    expect(Object.keys(SETTINGS_SCHEMA)).toContain("payments");
  });
  const num = specFor("economy", "episode_price");
  const bool = specFor("economy", "coins_enabled");
  const json = specFor("rewards", "daily_rewards");
  const text = specFor("site", "name");
  it("validates numbers within range", () => {
    expect(validate(null, "anything")).toBeNull();
    expect(validate(num, "abc")).toBe("Must be a number.");
    expect(validate(num, "-1")).toBe("Must be at least 0.");
    expect(validate(num, "10001")).toBe("Must be at most 10000.");
    expect(validate(num, " 50 ")).toBeNull();
    expect(validate(specFor("mobile", "min_version_code"), "99999")).toBeNull();
  });
  it("validates booleans, json and text", () => {
    expect(validate(bool, "yes")).toBe("Must be true or false.");
    expect(validate(bool, "true")).toBeNull();
    expect(validate(json, "[1,")).toBe("Not valid JSON.");
    expect(validate(json, "[1,2]")).toBeNull();
    expect(validate(text, "anything")).toBeNull();
  });
  it("coerces to the stored type", () => {
    expect(coerce(null, " raw ")).toBe(" raw ");
    expect(coerce(num, " 50 ")).toBe(50);
    expect(coerce(bool, "true")).toBe(true);
    expect(coerce(bool, "false")).toBe(false);
    expect(coerce(json, "[1,2]")).toEqual([1, 2]);
    expect(coerce(text, " raw ")).toBe(" raw ");
  });
});
