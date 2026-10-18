import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("contentSecurityPolicy", () => {
  it("is nonce-based, with no unsafe-inline scripts, and omits dev/https extras by default", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
    vi.stubEnv("NEXT_PUBLIC_MEDIA_ORIGINS", "");
    const { contentSecurityPolicy } = await import("./csp");
    const csp = contentSecurityPolicy("abc");
    const script = csp.split("; ").find((d) => d.startsWith("script-src"))!;
    expect(script).toContain("'nonce-abc'");
    expect(script).not.toContain("unsafe-inline");
    expect(script).not.toContain("unsafe-eval");
    expect(csp).not.toContain("upgrade-insecure-requests");
    expect(csp).not.toContain("ws:");
  });

  it("adds dev eval, https upgrade and media origins when configured", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://katha.app/");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.katha.app/");
    vi.stubEnv("NEXT_PUBLIC_MEDIA_ORIGINS", " https://cdn.katha.app , ,http://localhost:9000");
    const { contentSecurityPolicy } = await import("./csp");
    const csp = contentSecurityPolicy("n");
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain(" ws: wss:");
    expect(csp).toContain("connect-src 'self' https://api.katha.app https://cdn.katha.app http://localhost:9000");
    expect(csp).toContain("media-src 'self' blob: https://cdn.katha.app http://localhost:9000");
    expect(csp.endsWith("upgrade-insecure-requests")).toBe(true);
  });

  it("uses localhost API default when unset", async () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.NEXT_PUBLIC_MEDIA_ORIGINS;
    const { contentSecurityPolicy } = await import("./csp");
    expect(contentSecurityPolicy("n")).toContain("http://localhost:8000");
  });
});

describe("newNonce", () => {
  it("returns base64 of 16 random bytes, different each time", async () => {
    const { newNonce } = await import("./csp");
    const a = newNonce();
    expect(atob(a)).toHaveLength(16);
    expect(newNonce()).not.toBe(a);
  });
});
