// @vitest-environment node
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, proxy } from "./proxy";

const future = Math.floor(Date.now() / 1000) + 3600;
const past = Math.floor(Date.now() / 1000) - 10;
const session = (v: unknown) => `katha_admin_session=${encodeURIComponent(typeof v === "string" ? v : JSON.stringify(v))}`;

function req(path: string, cookie?: string) {
  return new NextRequest(`http://localhost:3001${path}`, cookie ? { headers: { cookie } } : undefined);
}
const location = (r: Response) => r.headers.get("location");

describe("proxy: unauthenticated", () => {
  it("redirects to /login with next, without a reason for first-time visitors", () => {
    const r = proxy(req("/users"));
    expect(r.status).toBe(307);
    const u = new URL(location(r)!);
    expect(u.pathname).toBe("/login");
    expect(u.searchParams.get("next")).toBe("/users");
    expect(u.searchParams.has("reason")).toBe(false);
  });
  it("marks expired sessions, clearing the cookie", () => {
    const r = proxy(req("/users", session({ exp: past, role: "owner" })));
    expect(new URL(location(r)!).searchParams.get("reason")).toBe("expired");
    expect(r.cookies.get("katha_admin_session")).toMatchObject({ value: "", maxAge: 0 });
  });
  it("clears the legacy JWT cookie too", () => {
    const r = proxy(req("/users", "katha_admin_token=old.jwt.here"));
    expect(new URL(location(r)!).searchParams.get("reason")).toBe("expired");
    expect(r.cookies.get("katha_admin_token")).toMatchObject({ value: "", maxAge: 0 });
    expect(r.cookies.get("katha_admin_session")).toBeUndefined();
  });
  it.each([["not-json"], ["null"], ['"str"'], ["%E0%A4%A"]])("treats malformed cookie %s as no session", (raw) => {
    const r = proxy(req("/users", `katha_admin_session=${raw}`));
    expect(new URL(location(r)!).pathname).toBe("/login");
    expect(new URL(location(r)!).searchParams.has("reason")).toBe(false);
  });
  it("lets the login page and public reset pages through", () => {
    for (const p of ["/login", "/forgot", "/reset"]) {
      const r = proxy(req(p));
      expect(r.status).toBe(200);
      expect(r.headers.get("content-security-policy")).toContain("default-src 'self'");
    }
  });
});

describe("proxy: authenticated", () => {
  it("bounces /login to the dashboard when the session is valid", () => {
    const r = proxy(req("/login", session({ exp: future, role: "owner" })));
    expect(new URL(location(r)!).pathname).toBe("/dashboard");
  });
  it("treats a cookie without exp as valid", () => {
    expect(proxy(req("/users", session({ role: "owner" }))).status).toBe(200);
    expect(proxy(req("/users", session({ exp: "soon", role: "owner" }))).status).toBe(200);
  });
  it("lets the index through and gates other paths by role", () => {
    expect(proxy(req("/", session({ exp: future, role: "owner" }))).status).toBe(200);
    expect(proxy(req("/users/x", session({ exp: future, role: "support" }))).status).toBe(200);
    for (const [path, role] of [["/accounts", "support"], ["/dramas", "finance"], ["/unknown", "owner"], ["/users", "hacker"], ["/users", undefined]] as const) {
      const r = proxy(req(path, session({ exp: future, role })));
      expect(r.status, `${role} ${path}`).toBe(307);
      expect(new URL(location(r)!).pathname).toBe("/dashboard");
    }
  });
  it("mints a fresh nonce per request and puts it on request and response", () => {
    const cookie = session({ exp: future, role: "owner" });
    const a = proxy(req("/dashboard", cookie));
    const b = proxy(req("/dashboard", cookie));
    const csp = (r: Response) => r.headers.get("content-security-policy")!;
    const nonce = (r: Response) => /'nonce-([^']+)'/.exec(csp(r))![1];
    expect(nonce(a)).not.toBe(nonce(b));
    // Next forwards overridden request headers via x-middleware-request-* on the response.
    expect(a.headers.get("x-middleware-request-x-nonce")).toBe(nonce(a));
    expect(a.headers.get("x-middleware-request-content-security-policy")).toBe(csp(a));
  });
  it("clears a legacy token cookie on pass-through", () => {
    const r = proxy(req("/dashboard", `${session({ exp: future, role: "owner" })}; katha_admin_token=old`));
    expect(r.cookies.get("katha_admin_token")).toMatchObject({ value: "", maxAge: 0 });
  });
});

describe("proxy matcher", () => {
  const re = new RegExp(`^${config.matcher[0]}$`);
  it("skips static assets and internals", () => {
    for (const p of ["/_next/static/x.js", "/favicon.ico", "/logo.svg", "/a/b.png"]) expect(re.test(p), p).toBe(false);
    for (const p of ["/dashboard", "/users/1", "/"]) expect(re.test(p), p).toBe(true);
  });
});
