import { NextRequest, NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  REFRESH_COOKIE,
  apiError,
  clearRefreshCookie,
  forwardedHeaders,
  passThrough,
  postApi,
  rejectCrossSite,
  tokenResponse,
  unreachable,
} from "./_bff";

const req = (headers: Record<string, string> = {}, url = "http://localhost:3000/api/auth/x") => new NextRequest(url, { method: "POST", headers });
const json = { "content-type": "application/json" };

afterEach(() => vi.unstubAllGlobals());

describe("apiError / unreachable", () => {
  it("uses the API error shape", async () => {
    const r = apiError(418, "teapot", "short");
    expect(r.status).toBe(418);
    expect(await r.json()).toEqual({ detail: { code: "teapot", message: "short" } });
    expect(unreachable().status).toBe(502);
  });
});

describe("rejectCrossSite", () => {
  it("requires application/json", () => {
    expect(rejectCrossSite(req({ "content-type": "text/plain" }))?.status).toBe(415);
    expect(rejectCrossSite(req())?.status).toBe(415);
    expect(rejectCrossSite(req({ "content-type": "Application/JSON; charset=utf-8", "sec-fetch-site": "same-origin" }))).toBeNull();
  });
  it("trusts Sec-Fetch-Site when present", () => {
    expect(rejectCrossSite(req({ ...json, "sec-fetch-site": "cross-site" }))?.status).toBe(403);
    expect(rejectCrossSite(req({ ...json, "sec-fetch-site": "same-site" }))?.status).toBe(403);
    expect(rejectCrossSite(req({ ...json, "sec-fetch-site": "same-origin" }))).toBeNull();
  });
  it("falls back to Origin matching the request or the site", () => {
    expect(rejectCrossSite(req(json))?.status).toBe(403);
    expect(rejectCrossSite(req({ ...json, origin: "https://evil.com" }))?.status).toBe(403);
    expect(rejectCrossSite(req({ ...json, origin: "http://localhost:3000", host: "localhost:3000" }))).toBeNull();
    expect(rejectCrossSite(req({ ...json, origin: "http://localhost:3000", host: "internal:9" }))).toBeNull(); // SITE_URL
    expect(
      rejectCrossSite(req({ ...json, origin: "https://katha.app", "x-forwarded-proto": "https, http", "x-forwarded-host": "katha.app, x" })),
    ).toBeNull();
  });
  it("derives the origin from the URL when no host header exists", () => {
    const r = req({ ...json, origin: "http://example.org:8080" }, "http://example.org:8080/api");
    r.headers.delete("host");
    expect(rejectCrossSite(r)).toBeNull();
  });
});

describe("forwardedHeaders", () => {
  it("carries bookkeeping headers and drops absent ones", () => {
    const h = forwardedHeaders(req({ "user-agent": "UA", "x-forwarded-for": "1.2.3.4", "cf-ipcountry": "IN" }));
    expect(h.get("user-agent")).toBe("UA");
    expect(h.get("x-forwarded-for")).toBe("1.2.3.4");
    expect(h.get("cf-ipcountry")).toBe("IN");
    expect(h.get("accept-language")).toBeNull();
    expect(h.get("X-Katha-Platform")).toBe("web");
    expect(h.get("Content-Type")).toBe("application/json");
  });
});

describe("postApi", () => {
  it("POSTs JSON to the API with extra headers and a timeout signal", async () => {
    const f = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", f);
    const res = await postApi(req({ "user-agent": "UA" }), "/v1/x", { a: 1 }, { Authorization: "Bearer t" }, 123);
    expect(res).toBeInstanceOf(Response);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("http://localhost:8000/v1/x");
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"a":1}');
    expect(init.cache).toBe("no-store");
    expect(init.headers.get("Authorization")).toBe("Bearer t");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it("returns null when the API is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("down")));
    expect(await postApi(req(), "/v1/x", {})).toBeNull();
  });
});

describe("cookies", () => {
  const pair = { access_token: "acc", refresh_token: "ref", expires_in: 900 };
  it("tokenResponse exposes only the access token and sets an httpOnly lax cookie", async () => {
    const r = tokenResponse(req(), pair);
    expect(await r.json()).toEqual({ access_token: "acc", expires_in: 900, is_new_user: false });
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    const c = r.cookies.get(REFRESH_COOKIE)!;
    expect(c.value).toBe("ref");
    const raw = r.headers.get("set-cookie")!;
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=lax/i);
    expect(raw).toMatch(/Path=\/api\/auth/);
    expect(raw).toMatch(/Max-Age=2592000/);
    expect(raw).not.toMatch(/Secure/i);
  });
  it("passes through is_new_user and marks Secure behind https", async () => {
    const viaProxy = tokenResponse(req({ "x-forwarded-proto": "https" }), { ...pair, is_new_user: true });
    expect((await viaProxy.json()).is_new_user).toBe(true);
    expect(viaProxy.headers.get("set-cookie")).toMatch(/Secure/i);
    const viaUrl = tokenResponse(req({}, "https://katha.app/api/auth/x"), pair);
    expect(viaUrl.headers.get("set-cookie")).toMatch(/Secure/i);
  });
  it("clearRefreshCookie expires the cookie", () => {
    const r = clearRefreshCookie(req(), NextResponse.json({}));
    expect(r.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("passThrough", () => {
  it("copies status and body", async () => {
    const r = await passThrough(new Response('{"detail":"x"}', { status: 409 }));
    expect(r.status).toBe(409);
    expect(await r.text()).toBe('{"detail":"x"}');
    expect(r.headers.get("Content-Type")).toBe("application/json");
  });
  it("synthesises a body when upstream sent none", async () => {
    const r = await passThrough(new Response("", { status: 500 }));
    expect(await r.json()).toEqual({ detail: { code: "error", message: "Request failed (500)" } });
  });
});
