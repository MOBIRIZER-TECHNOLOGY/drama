import { fakeJwt } from "@/test/jwt";
import { describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE, TOKEN_KEY, clearToken, getToken, setToken, tokenStore } from "./token";

function cookieClaims() {
  const m = document.cookie.match(new RegExp(`${SESSION_COOKIE}=([^;]*)`));
  return m ? JSON.parse(decodeURIComponent(m[1])) : null;
}

describe("token", () => {
  it("stores the token and a {exp, role} session cookie decoded from the JWT", () => {
    const jwt = fakeJwt({ role: "editor", exp: 4_000_000_000 });
    setToken(jwt, 100);
    expect(getToken()).toBe(jwt);
    expect(tokenStore.getAccessToken()).toBe(jwt);
    expect(cookieClaims()).toEqual({ exp: 4_000_000_000, role: "editor" });
    expect(document.cookie).not.toContain(jwt);
  });
  it("falls back to now+ttl for undecodable tokens or tokens without exp", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    const now = Math.floor(Date.now() / 1000);
    setToken("garbage", 50);
    expect(cookieClaims().exp).toBe(now + 50);
    const noExp = fakeJwt({ role: "owner" });
    setToken(noExp, 70);
    expect(cookieClaims()).toEqual({ exp: now + 70, role: "owner" });
    vi.useRealTimers();
  });
  it("clearToken removes storage and cookies", () => {
    setToken("x", 10);
    document.cookie = `${TOKEN_KEY}=legacy; path=/`;
    clearToken();
    expect(getToken()).toBeNull();
    expect(cookieClaims()).toBeNull();
    expect(document.cookie).not.toContain("legacy");
  });
  it("survives unavailable storage", () => {
    const spy = vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(getToken()).toBeNull();
    spy.mockRestore();
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(window.localStorage, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => setToken("x", 5)).not.toThrow();
    expect(cookieClaims()).not.toBeNull();
    expect(() => clearToken()).not.toThrow();
  });
  it("adds Secure on https", () => {
    const set = vi.spyOn(document, "cookie", "set");
    Object.defineProperty(window, "location", { value: { protocol: "https:" }, configurable: true, writable: true });
    setToken("x", 5);
    expect(set.mock.calls[0][0]).toContain("; Secure");
  });
});
