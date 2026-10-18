import { afterEach, describe, expect, it, vi } from "vitest";
import { formatCoins, formatDate, formatDay, formatDuration, formatMoney, formatNumber, formatRelative } from "./format";

afterEach(() => vi.useRealTimers());

describe("formatMoney", () => {
  it("drops decimals for whole amounts and keeps them otherwise", () => {
    expect(formatMoney(99, "INR", "en-IN")).toBe("₹99");
    expect(formatMoney(99.5, "INR", "en-IN")).toBe("₹99.50");
  });
  it("falls back for an invalid currency", () => {
    expect(formatMoney(5, "??")).toBe("?? 5");
    expect(formatMoney(5.5, "??")).toBe("?? 5.50");
  });
});

describe("formatNumber / formatCoins", () => {
  it("compacts only at 10k+", () => {
    expect(formatNumber(9999)).toBe("9,999");
    expect(formatNumber(12500)).toBe("12.5K");
  });
  it("never rounds coins", () => {
    expect(formatCoins(12500)).toBe("12,500");
  });
  it("falls back to String on bad locale", () => {
    expect(formatNumber(5, "not a locale!!")).toBe("5");
    expect(formatCoins(5, "not a locale!!")).toBe("5");
  });
});

describe("formatDuration", () => {
  it("formats m:ss and h:mm:ss", () => {
    expect(formatDuration(65.9)).toBe("1:05");
    expect(formatDuration(3725)).toBe("1:02:05");
    expect(formatDuration(0)).toBe("0:00");
  });
  it("is 0:00 for invalid input", () => {
    expect(formatDuration(null)).toBe("0:00");
    expect(formatDuration(undefined)).toBe("0:00");
    expect(formatDuration(NaN)).toBe("0:00");
    expect(formatDuration(-1)).toBe("0:00");
  });
});

describe("formatDate / formatDay", () => {
  it("handles empty and invalid", () => {
    expect(formatDate(null)).toBe("");
    expect(formatDate("garbage")).toBe("");
    expect(formatDay(undefined)).toBe("");
    expect(formatDay("garbage")).toBe("");
  });
  it("formats valid dates", () => {
    expect(formatDate("2026-03-05T10:00:00Z", "en")).toMatch(/Mar 5, 2026/);
    expect(formatDay("2026-03-05T12:00:00Z", "en")).toMatch(/March 5, 2026/);
  });
  it("falls back to toLocale* on a bad locale", () => {
    expect(formatDate("2026-03-05T10:00:00Z", "bad locale!!")).toBe(new Date("2026-03-05T10:00:00Z").toLocaleString());
    expect(formatDay("2026-03-05T10:00:00Z", "bad locale!!")).toBe(new Date("2026-03-05T10:00:00Z").toLocaleDateString());
  });
});

describe("formatRelative", () => {
  const now = new Date("2026-06-01T00:00:00Z");
  it("picks the largest fitting unit", () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(formatRelative(null)).toBe("");
    expect(formatRelative("garbage")).toBe("");
    expect(formatRelative("2026-05-31T00:00:00Z")).toBe("yesterday");
    expect(formatRelative("2026-05-31T22:00:00Z")).toBe("2 hours ago");
    expect(formatRelative("2026-05-31T23:55:00Z")).toBe("5 minutes ago");
    expect(formatRelative("2026-05-31T23:59:30Z")).toBe("30 seconds ago");
    expect(formatRelative("2026-05-18T00:00:00Z")).toBe("2 weeks ago");
    expect(formatRelative("2026-03-01T00:00:00Z")).toBe("3 months ago");
    expect(formatRelative("2024-06-01T00:00:00Z")).toBe("2 years ago");
  });
  it("falls back to formatDate on bad locale", () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(formatRelative("2026-05-31T00:00:00Z", "bad locale!!")).toBe(formatDate("2026-05-31T00:00:00Z", "bad locale!!"));
  });
});
