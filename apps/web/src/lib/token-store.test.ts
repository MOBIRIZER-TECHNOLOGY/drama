import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshMock = vi.fn();
vi.mock("./auth-bff", () => ({ authBff: { refresh: () => refreshMock() } }));

type Mod = typeof import("./token-store");
let tokenStore: Mod["tokenStore"];
const KEY = "katha.tokens";
const NOW = 1_700_000_000_000;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.resetModules();
  refreshMock.mockReset();
  window.localStorage.clear();
  tokenStore = (await import("./token-store")).tokenStore;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, "locks", { value: undefined, configurable: true });
});

const store = (access_token: string, expires_at: number, extra: object = {}) =>
  window.localStorage.setItem(KEY, JSON.stringify({ access_token, expires_at, ...extra }));

describe("tokenStore basics", () => {
  it("set persists the token with a minimum 60s lifetime and notifies as local", () => {
    const fn = vi.fn();
    tokenStore.subscribe(fn);
    tokenStore.set({ access_token: "a", expires_in: 900 });
    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toEqual({ access_token: "a", expires_at: NOW + 900_000 });
    expect(fn).toHaveBeenCalledWith({ access_token: "a", expires_at: NOW + 900_000 }, "local");
    tokenStore.set({ access_token: "b", expires_in: 1 });
    expect(JSON.parse(window.localStorage.getItem(KEY)!).expires_at).toBe(NOW + 60_000);
    expect(tokenStore.has()).toBe(true);
    expect(tokenStore.current()).toBe("b");
  });

  it("clear removes everything and unsubscribe stops notifications", () => {
    const fn = vi.fn();
    const off = tokenStore.subscribe(fn);
    tokenStore.set({ access_token: "a", expires_in: 900 });
    tokenStore.clear();
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(tokenStore.has()).toBe(false);
    expect(tokenStore.current()).toBeNull();
    expect(fn).toHaveBeenLastCalledWith(null, "local");
    off();
    tokenStore.clear();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("keeps a memory copy when storage writes fail", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    tokenStore.set({ access_token: "mem", expires_in: 900 });
    expect(tokenStore.current()).toBe("mem");
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("denied");
    });
    tokenStore.clear();
    expect(tokenStore.current()).toBeNull();
  });

  it("reads a stored session and strips a legacy refresh token", () => {
    store("old", NOW + 1e6, { refresh_token: "secret" });
    expect(tokenStore.current()).toBe("old");
    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toEqual({ access_token: "old", expires_at: NOW + 1e6 });
  });

  it("discards malformed or unreadable storage", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ access_token: 5 }));
    expect(tokenStore.has()).toBe(false);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("treats corrupt JSON as signed out", async () => {
    window.localStorage.setItem(KEY, "{nope");
    expect(tokenStore.has()).toBe(false);
  });

  it("is signed out without a stored value", () => {
    expect(tokenStore.has()).toBe(false);
  });
});

describe("deviceId", () => {
  it("creates and persists an id", () => {
    const id = tokenStore.deviceId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(tokenStore.deviceId()).toBe(id);
    expect(window.localStorage.getItem("katha.device_id")).toBe(id);
  });
  it("falls back when randomUUID is missing or storage throws", () => {
    vi.stubGlobal("crypto", {});
    expect(tokenStore.deviceId()).toMatch(/^web-[0-9a-z]+$/);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("x");
    });
    expect(tokenStore.deviceId()).toBe("web");
  });
});

describe("getAccessToken / refresh", () => {
  it("returns null when signed out and does not call the BFF", async () => {
    expect(await tokenStore.getAccessToken()).toBeNull();
    expect(await tokenStore.refresh!()).toBeNull();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("returns a still-fresh token without refreshing (30s skew)", async () => {
    store("fresh", NOW + 31_000);
    expect(await tokenStore.getAccessToken()).toBe("fresh");
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("refreshes through the BFF when within the skew window", async () => {
    store("stale", NOW + 10_000);
    refreshMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ access_token: "new", expires_in: 900 }) });
    expect(await tokenStore.getAccessToken()).toBe("new");
    expect(tokenStore.current()).toBe("new");
  });

  it("single-flights concurrent refreshes", async () => {
    store("stale", NOW - 1);
    refreshMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ access_token: "new", expires_in: 900 }) });
    const [a, b] = await Promise.all([tokenStore.refresh!(), tokenStore.refresh!()]);
    expect([a, b]).toEqual(["new", "new"]);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403])("clears the session when the BFF says %s", async (status) => {
    store("stale", NOW - 1);
    refreshMock.mockResolvedValue({ ok: false, status });
    const fn = vi.fn();
    tokenStore.subscribe(fn);
    expect(await tokenStore.refresh!()).toBeNull();
    expect(tokenStore.has()).toBe(false);
    expect(fn).toHaveBeenCalledWith(null, "local");
  });

  it("keeps the current token on a transient server error or when offline", async () => {
    store("stale", NOW - 1);
    refreshMock.mockResolvedValueOnce({ ok: false, status: 503 });
    expect(await tokenStore.refresh!()).toBe("stale");
    refreshMock.mockRejectedValueOnce(new TypeError("offline"));
    expect(await tokenStore.refresh!()).toBe("stale");
  });

  it("reuses a token another tab refreshed while waiting", async () => {
    store("stale", NOW - 1);
    tokenStore.current(); // load into memory
    store("rotated", NOW + 1e6);
    expect(await tokenStore.refresh!()).toBe("rotated");
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("returns null if the session vanished from storage during the wait", async () => {
    store("stale", NOW - 1);
    tokenStore.current();
    window.localStorage.removeItem(KEY);
    expect(await tokenStore.refresh!()).toBeNull();
  });

  it("serialises through Web Locks when available", async () => {
    store("stale", NOW - 1);
    const request = vi.fn(async (_name: string, cb: () => Promise<unknown>) => cb());
    Object.defineProperty(navigator, "locks", { value: { request }, configurable: true });
    refreshMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ access_token: "new", expires_in: 900 }) });
    expect(await tokenStore.refresh!()).toBe("new");
    expect(request).toHaveBeenCalledWith("katha.refresh", expect.any(Function));
  });
});

describe("cross-tab storage events", () => {
  it("re-reads and notifies with source 'storage' for its key only", () => {
    const fn = vi.fn();
    tokenStore.subscribe(fn);
    tokenStore.set({ access_token: "mine", expires_in: 900 });
    fn.mockClear();
    store("theirs", NOW + 5e5);
    window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
    expect(fn).toHaveBeenCalledWith({ access_token: "theirs", expires_at: NOW + 5e5 }, "storage");
    fn.mockClear();
    window.dispatchEvent(new StorageEvent("storage", { key: "other" }));
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("without a window", () => {
  it("is inert on the server", async () => {
    vi.resetModules();
    vi.stubGlobal("window", undefined);
    const mod = await import("./token-store");
    expect(mod.tokenStore.has()).toBe(false);
    expect(mod.tokenStore.deviceId()).toBe("server");
    expect(await mod.tokenStore.getAccessToken()).toBeNull();
    mod.tokenStore.set({ access_token: "a", expires_in: 900 });
    expect(mod.tokenStore.current()).toBe("a");
  });
});
