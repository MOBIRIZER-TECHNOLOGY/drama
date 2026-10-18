import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureReferral, clearReferral, pendingReferral } from "./referral";

beforeEach(() => window.sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("referral", () => {
  it("captures ?ref uppercased and trims", () => {
    captureReferral("?ref=%20abcd1234 ");
    expect(pendingReferral()).toBe("ABCD1234");
  });
  it("accepts ?referral", () => {
    captureReferral("?referral=zzzz9999");
    expect(pendingReferral()).toBe("ZZZZ9999");
  });
  it("ignores malformed codes", () => {
    captureReferral("?ref=ab");
    captureReferral("?ref=bad!code");
    captureReferral("");
    expect(pendingReferral()).toBeNull();
  });
  it("first link wins", () => {
    captureReferral("?ref=FIRST111");
    captureReferral("?ref=SECOND22");
    expect(pendingReferral()).toBe("FIRST111");
  });
  it("clears", () => {
    captureReferral("?ref=ABCD1234");
    clearReferral();
    expect(pendingReferral()).toBeNull();
  });
  it("survives blocked storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => captureReferral("?ref=ABCD1234")).not.toThrow();
    expect(pendingReferral()).toBeNull();
    expect(() => clearReferral()).not.toThrow();
  });
});

describe("referral on the server", () => {
  it("is inert without a window", () => {
    vi.stubGlobal("window", undefined);
    try {
      expect(() => captureReferral("?ref=ABCD1234")).not.toThrow();
      expect(pendingReferral()).toBeNull();
      expect(() => clearReferral()).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
