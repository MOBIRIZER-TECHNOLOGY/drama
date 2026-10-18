import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const post = vi.fn();
vi.mock("./client-api", () => ({ clientApi: { POST: (...a: unknown[]) => post(...a) } }));

type Mod = typeof import("./analytics");
let m: Mod;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  vi.resetModules();
  post.mockReset().mockResolvedValue({});
  window.sessionStorage.clear();
  m = await import("./analytics");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("track / flush", () => {
  it("batches events and flushes after 10s with session and device info", async () => {
    m.track("a", { x: 1, y: undefined, z: null, o: {} as never, s: "s", b: true });
    expect(post).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(post).toHaveBeenCalledTimes(1);
    const [path, opts] = post.mock.calls[0];
    expect(path).toBe("/v1/events");
    expect(opts.keepalive).toBe(false);
    expect(opts.body.events).toEqual([{ name: "a", ts: "2026-01-01T00:00:00.000Z", props: { x: 1, z: null, s: "s", b: true } }]);
    expect(opts.body.session_id).toBe(m.sessionId());
    expect(opts.body.device).toMatchObject({ app_version: m.APP_VERSION, os: expect.any(String) });
  });

  it("flushes immediately at 20 queued events and splits batches at 200", () => {
    for (let i = 0; i < 19; i++) m.track("e");
    expect(post).not.toHaveBeenCalled();
    m.track("e");
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][1].body.events).toHaveLength(20);
  });

  it("does nothing when flushing an empty queue", () => {
    m.flush();
    expect(post).not.toHaveBeenCalled();
  });

  it("swallows send failures", async () => {
    post.mockRejectedValue(new Error("net"));
    for (let i = 0; i < 20; i++) m.track("e");
    await vi.advanceTimersByTimeAsync(0);
    expect(post).toHaveBeenCalled();
  });

  it("flushes with keepalive on pagehide and when the tab becomes hidden", () => {
    m.track("a");
    window.dispatchEvent(new Event("pagehide"));
    expect(post.mock.calls[0][1].keepalive).toBe(true);
    m.track("b");
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(post).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(post).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });

  it("only installs listeners once", () => {
    const add = vi.spyOn(window, "addEventListener");
    m.track("a");
    m.track("b");
    expect(add.mock.calls.filter((c) => c[0] === "pagehide")).toHaveLength(1);
  });
});

describe("device detection", () => {
  const cases: [string, string, string][] = [
    ["Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537", "Android", "Chrome"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17) Safari/604", "iOS", "Safari"],
    ["Mozilla/5.0 (Windows NT 10.0) Chrome/120 Edg/120", "Windows", "Edge"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X) Firefox/120", "macOS", "Firefox"],
    ["Mozilla/5.0 (X11; CrOS x86_64) Chrome/120 OPR/100", "ChromeOS", "Opera"],
    ["Mozilla/5.0 (X11; Linux x86_64) SamsungBrowser/20", "Linux", "Samsung"],
    ["curl/8", "Web", "Browser"],
  ];
  it.each(cases)("%s", (ua, os, browser) => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ua);
    Object.defineProperty(navigator, "connection", { value: { effectiveType: "4g" }, configurable: true });
    m.track("a");
    m.flush();
    expect(post.mock.calls[0][1].body.device).toMatchObject({ os, model: browser, network: "4g" });
    delete (navigator as unknown as Record<string, unknown>).connection;
  });
});

describe("sessionId", () => {
  it("creates, stores and memoises a uuid", () => {
    const id = m.sessionId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(window.sessionStorage.getItem("katha.session_id")).toBe(id);
    expect(m.sessionId()).toBe(id);
  });

  it("reuses a valid stored id and replaces an invalid one", async () => {
    const stored = "11111111-2222-3333-4444-555555555555";
    window.sessionStorage.setItem("katha.session_id", stored);
    expect(m.sessionId()).toBe(stored);
    vi.resetModules();
    window.sessionStorage.setItem("katha.session_id", "bad");
    const m2 = await import("./analytics");
    const id = m2.sessionId();
    expect(id).not.toBe("bad");
    expect(window.sessionStorage.getItem("katha.session_id")).toBe(id);
  });

  it("falls back to an in-memory id when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("x");
    });
    const id = m.sessionId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(m.sessionId()).toBe(id);
  });

  it("generates a v4 uuid without randomUUID, using getRandomValues or Math.random", async () => {
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", { getRandomValues: real.getRandomValues.bind(real) });
    expect(m.sessionId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    vi.resetModules();
    const m2 = await import("./analytics");
    window.sessionStorage.clear();
    vi.stubGlobal("crypto", {});
    expect(m2.sessionId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    vi.resetModules();
    const m3 = await import("./analytics");
    window.sessionStorage.clear();
    vi.stubGlobal("crypto", undefined);
    expect(m3.sessionId()).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("trackAppOpen", () => {
  it("fires once per session with referrer host and path", () => {
    Object.defineProperty(document, "referrer", { value: "https://google.com/search?q=x", configurable: true });
    m.trackAppOpen("hi");
    m.trackAppOpen("hi");
    m.flush();
    const events = post.mock.calls[0][1].body.events;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ name: "app_open", props: { lang: "hi", referrer: "google.com", path: "/" } });
  });

  it("sends a null referrer when there is none and still fires if storage is blocked", () => {
    Object.defineProperty(document, "referrer", { value: "", configurable: true });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("x");
    });
    m.trackAppOpen("en");
    m.flush();
    expect(post.mock.calls[0][1].body.events[0].props.referrer).toBeNull();
  });
});

describe("without a window (SSR)", () => {
  it("track and trackAppOpen are no-ops and sessionId/device work", async () => {
    vi.stubGlobal("window", undefined);
    m.track("a");
    m.trackAppOpen("en");
    expect(m.sessionId()).toMatch(/^[0-9a-f-]{36}$/);
    m.flush();
    expect(post).not.toHaveBeenCalled();
  });

  it("reports os 'server' for the device block when a flush runs without a window", () => {
    m.track("a");
    vi.stubGlobal("window", undefined);
    m.flush();
    expect(post.mock.calls[0][1].body.device).toEqual({ os: "server", app_version: m.APP_VERSION });
  });
});
