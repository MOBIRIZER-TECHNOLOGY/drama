import { afterEach, describe, expect, it, vi } from "vitest";

async function load(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) vi.stubEnv(k, undefined as never);
    else vi.stubEnv(k, v);
  }
  return (await import("./csp")).buildCsp("N0NC3");
}
afterEach(() => vi.unstubAllEnvs());
const directive = (csp: string, name: string) => csp.split("; ").find((d) => d.startsWith(name + " "))!;

describe("buildCsp", () => {
  it("is strict in production: nonce + strict-dynamic, no eval, no http images", async () => {
    const csp = await load({ NODE_ENV: "production", NEXT_PUBLIC_API_URL: "https://api.example.com/v1", NEXT_PUBLIC_UPLOAD_ORIGINS: "https://s3.example.com/bucket  https://cdn.example.com not-a-url" });
    expect(directive(csp, "script-src")).toBe("script-src 'self' 'nonce-N0NC3' 'strict-dynamic'");
    expect(directive(csp, "connect-src")).toBe("connect-src 'self' https://api.example.com https://s3.example.com https://cdn.example.com");
    expect(directive(csp, "img-src")).toBe("img-src 'self' https: data: blob:");
    expect(directive(csp, "font-src")).toContain("'self'");
    for (const d of ["frame-ancestors 'none'", "base-uri 'none'", "object-src 'none'", "form-action 'self'"]) expect(csp).toContain(d);
  });
  it("allows eval, http images and local MinIO in development", async () => {
    const csp = await load({ NODE_ENV: "development", NEXT_PUBLIC_API_URL: undefined, NEXT_PUBLIC_UPLOAD_ORIGINS: undefined });
    expect(directive(csp, "script-src")).toContain("'unsafe-eval'");
    expect(directive(csp, "img-src")).toContain(" http:");
    expect(directive(csp, "connect-src")).toBe("connect-src 'self' http://localhost:8000 http://localhost:9000");
  });
  it("has no upload origins by default in production and drops an unparsable API URL", async () => {
    const csp = await load({ NODE_ENV: "production", NEXT_PUBLIC_API_URL: "nope", NEXT_PUBLIC_UPLOAD_ORIGINS: undefined });
    expect(directive(csp, "connect-src")).toBe("connect-src 'self'");
  });
});
