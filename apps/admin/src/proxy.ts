import { decodeJwt } from "jose";
import { NextResponse, type NextRequest } from "next/server";
import { canAccess, isRole } from "@/lib/nav";

const TOKEN_KEY = "katha_admin_token";
const PUBLIC_PATHS = new Set(["/forgot", "/reset"]);

/**
 * Optimistic auth gate (Next 16 "proxy", formerly middleware). The token is *decoded*, not verified:
 * the API verifies the signature on every call. This only avoids rendering the shell for visitors
 * with no/expired cookie and keeps roles out of sections they cannot use.
 */
export function proxy(request: NextRequest) {
  const token = request.cookies.get(TOKEN_KEY)?.value;
  const { pathname } = request.nextUrl;

  const claims = token ? safeDecode(token) : null;
  const now = Math.floor(Date.now() / 1000);
  const valid = claims != null && (claims.exp == null || claims.exp > now);

  if (pathname === "/login") {
    return valid ? NextResponse.redirect(new URL("/dashboard", request.url)) : NextResponse.next();
  }
  // Password reset pages are reachable without (or with) a session.
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  if (!valid) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname);
    if (token) url.searchParams.set("reason", "expired");
    const res = NextResponse.redirect(url);
    if (token) res.cookies.set(TOKEN_KEY, "", { path: "/", maxAge: 0 });
    return res;
  }

  if (pathname === "/") return NextResponse.next(); // the index page redirects to /dashboard itself

  const role = claims.role;
  if (!isRole(role) || !canAccess(role, pathname)) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  return NextResponse.next();
}

function safeDecode(token: string): { exp?: number; role?: unknown } | null {
  try {
    const payload = decodeJwt(token);
    return { exp: payload.exp, role: (payload as { role?: unknown }).role };
  } catch {
    return null;
  }
}

export const config = {
  matcher: ["/((?!_next/|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)"],
};
