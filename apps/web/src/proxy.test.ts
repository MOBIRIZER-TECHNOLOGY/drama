import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, proxy } from "./proxy";

const req = (path: string, headers: Record<string, string> = {}) => new NextRequest(`http://localhost:3000${path}`, { headers });

describe("proxy language routing", () => {
  it("rewrites an unprefixed path to the default language, URL unchanged", () => {
    const res = proxy(req("/series/x"));
    expect(res.headers.get("x-middleware-rewrite")).toBe("http://localhost:3000/en/series/x");
  });

  it("rewrites the root to /en", () => {
    expect(proxy(req("/")).headers.get("x-middleware-rewrite")).toBe("http://localhost:3000/en");
  });

  it("passes a supported language prefix through", () => {
    const res = proxy(req("/hi/series/x"));
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("redirects an explicit default-language prefix to the canonical path (308)", () => {
    const res = proxy(req("/en/series/x?a=1"));
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("http://localhost:3000/series/x?a=1");
  });

  it("does not redirect the internal rewrite target", () => {
    const res = proxy(req("/en/series/x", { "x-katha-locale-rewrite": "1" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
});

describe("proxy CSP nonce", () => {
  it("sets a per-response nonce in the CSP header and forwards it on the request", () => {
    const a = proxy(req("/hi"));
    const b = proxy(req("/hi"));
    const csp = a.headers.get("Content-Security-Policy")!;
    const nonce = /'nonce-([^']+)'/.exec(csp)![1];
    expect(a.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
    expect(a.headers.get("x-middleware-request-content-security-policy")).toBe(csp);
    expect(b.headers.get("Content-Security-Policy")).not.toBe(csp);
  });

  it("marks the rewrite request so the second pass is not redirected, and strips a spoofed header on pass-through", () => {
    const rewritten = proxy(req("/series/x"));
    expect(rewritten.headers.get("x-middleware-request-x-katha-locale-rewrite")).toBe("1");
    const passed = proxy(req("/hi/x", { "x-katha-locale-rewrite": "1" }));
    expect(passed.headers.get("x-middleware-request-x-katha-locale-rewrite")).toBeNull();
  });
});

describe("proxy matcher", () => {
  const re = new RegExp(`^${config.matcher[0]}$`);
  it.each(["/", "/series/x", "/series/my.drama", "/hi/wallet"])("matches %s", (p) => expect(re.test(p)).toBe(true));
  it.each(["/_next/static/x.js", "/api/auth/exchange", "/favicon.ico", "/logo.png", "/a/b.m3u8", "/robots.txt"])("skips %s", (p) =>
    expect(re.test(p)).toBe(false),
  );
});
