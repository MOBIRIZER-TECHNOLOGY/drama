import { NextResponse, type NextRequest } from "next/server";
import { buildCsp } from "@/lib/csp";
import { canAccess, isRole } from "@/lib/nav";

/**
 * What `lib/token.ts` writes for this gate: `{exp, role}` as JSON, not the JWT. The JWT stays in localStorage
 * only, so a cookie the browser sends on every request (and any script can read) no longer carries a bearer
 * token. Duplicated here rather than imported: the proxy is meant to stand alone from the app's modules.
 */
const SESSION_COOKIE = "katha_admin_session";
/** The cookie earlier builds set. Cleared when seen so a stale JWT does not linger after the migration. */
const LEGACY_TOKEN_COOKIE = "katha_admin_token";
const PUBLIC_PATHS = new Set(["/forgot", "/reset"]);

/**
 * Optimistic auth gate (Next 16 "proxy", formerly middleware). The session claims are *read*, not verified:
 * the API verifies the signature on every call. This only avoids rendering the shell for visitors with
 * no/expired cookie and keeps roles out of sections they cannot use.
 *
 * It also mints the per-request script nonce for the CSP (`lib/csp.ts`): the header goes on the response for
 * the browser and, as `x-nonce`, on the request for the root layout. Set here rather than in `next.config.ts`
 * because a static header cannot carry a value that has to differ on every request.
 */
export function proxy(request: NextRequest) {
  const legacy = request.cookies.get(LEGACY_TOKEN_COOKIE)?.value;
  const claims = readSession(request.cookies.get(SESSION_COOKIE)?.value);
  const { pathname } = request.nextUrl;

  const now = Math.floor(Date.now() / 1000);
  const valid = claims != null && (claims.exp == null || claims.exp > now);

  if (pathname === "/login") {
    return valid ? NextResponse.redirect(new URL("/dashboard", request.url)) : pass(request, legacy);
  }
  // Password reset pages are reachable without (or with) a session.
  if (PUBLIC_PATHS.has(pathname)) return pass(request, legacy);

  if (!valid) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname);
    if (claims || legacy) url.searchParams.set("reason", "expired");
    const res = NextResponse.redirect(url);
    if (claims) res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
    if (legacy) res.cookies.set(LEGACY_TOKEN_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  }

  if (pathname === "/") return pass(request, legacy); // the index page redirects to /dashboard itself

  const role = claims.role;
  if (!isRole(role) || !canAccess(role, pathname)) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  return pass(request, legacy);
}

/** Let the request through with a fresh nonce on both sides of it. */
function pass(request: NextRequest, legacyCookie: string | undefined) {
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Next reads the nonce back out of this request header when it renders, which is how its own scripts get it.
  requestHeaders.set("Content-Security-Policy", csp);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  if (legacyCookie) res.cookies.set(LEGACY_TOKEN_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

function readSession(raw: string | undefined): { exp?: number; role?: unknown } | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(raw));
    if (!parsed || typeof parsed !== "object") return null;
    const { exp, role } = parsed as { exp?: unknown; role?: unknown };
    return { exp: typeof exp === "number" ? exp : undefined, role };
  } catch {
    return null;
  }
}

export const config = {
  matcher: ["/((?!_next/|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)"],
};
