import { NextResponse, type NextRequest } from "next/server";
import { API_URL, SITE_URL } from "@/lib/api";

/**
 * Shared pieces of the auth BFF: the three route handlers next to this file are the only code on this origin
 * that ever sees the refresh token.
 *
 * Why a BFF at all. The API is a separate origin that speaks bearer tokens to three clients. The browser used
 * to hold the 30-day refresh token in localStorage, where any script that runs on the page can read it; the
 * nonce CSP (src/lib/csp.ts) narrows "any script", but a leak was still a month of access. Now the refresh
 * token travels in an httpOnly cookie scoped to `/api/auth`, which no script can read, and the page only ever
 * holds the fifteen-minute access token. These handlers forward to the API's /v1/auth/{exchange,refresh,logout}
 * and translate between "refresh token in the body" (the API's contract, shared with the mobile app) and
 * "refresh token in the cookie" (what this origin wants).
 *
 * CSRF. A cookie that the browser attaches by itself needs the handlers to know the request came from this
 * site's own pages, or any page could refresh a visitor's session and read the access token it returns. Three
 * independent things say it did, and every handler requires all of them (see `rejectCrossSite`):
 *
 *   1. SameSite=Lax on the cookie. The browser omits it from cross-site POSTs entirely, so a foreign page's
 *      request arrives with no session to act on. (Lax still sends it on top-level GET navigations, which is
 *      why the handlers accept POST only.)
 *   2. `Content-Type: application/json`. An HTML form cannot produce it, and a cross-site `fetch` that sets it
 *      is preflighted; these handlers never answer a preflight with Access-Control-Allow-Origin, so the
 *      browser never sends the real request.
 *   3. `Sec-Fetch-Site: same-origin` (every current browser), or failing that an `Origin` equal to this site.
 *      Both are set by the browser and cannot be forged from a page.
 *
 * Any one of these would do on its own for a modern browser; requiring all three means a bug in one, or an
 * old browser without Fetch Metadata, does not open the door. There is deliberately no synchroniser token:
 * it would have to live somewhere script can read, which is the posture this file exists to leave behind.
 */

/** Cookie name. Mirrored in e2e/support/fixture.ts, which seeds it for the suite. */
export const REFRESH_COOKIE = "katha_refresh";
/** Only the auth handlers receive the cookie: a page, an image or an RSC request never carries it. */
export const REFRESH_COOKIE_PATH = "/api/auth";
/** Matches the API's refresh_token_ttl_seconds; each rotation restarts it, the API's own session expiry is what actually ends it. */
const REFRESH_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * Where the handlers reach the API. Server-side, so a deployment can point this at an internal address
 * (`API_INTERNAL_URL`) while the browser keeps using the public one for everything else.
 */
export const API_ORIGIN = (process.env.API_INTERNAL_URL ?? API_URL).replace(/\/$/, "");

/** The API's error shape, so the browser's `toApiError` reads BFF errors the same way it reads API ones. */
export function apiError(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ detail: { code, message } }, { status });
}

function isHttps(request: NextRequest): boolean {
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return forwarded === "https" || request.nextUrl.protocol === "https:" || SITE_URL.startsWith("https://");
}

/** The origin a browser would report for this request, honouring the proxy in front of a deployment. */
function requestOrigin(request: NextRequest): string {
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || request.nextUrl.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host") || request.nextUrl.host;
  return `${proto}://${host}`;
}

/** Returns a 403 response when the request did not come from one of this site's own pages; null when it did. */
export function rejectCrossSite(request: NextRequest): NextResponse | null {
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(type)) {
    return apiError(415, "unsupported_media_type", "Expected application/json");
  }
  const site = request.headers.get("sec-fetch-site");
  if (site !== null) {
    if (site !== "same-origin") return apiError(403, "cross_site", "Cross-site request refused");
    return null;
  }
  const origin = request.headers.get("origin");
  if (!origin || (origin !== requestOrigin(request) && origin !== SITE_URL)) {
    return apiError(403, "cross_site", "Cross-site request refused");
  }
  return null;
}

/**
 * Headers the API reads for session bookkeeping and rate limiting, carried over from the browser's request.
 * X-Forwarded-For is only believed by the API when this server's address is in its KATHA_FORWARDED_ALLOW_IPS;
 * without that every web sign-in shares one IP for rate-limit purposes, which is the deployment's to fix.
 */
export function forwardedHeaders(request: NextRequest): Headers {
  const headers = new Headers({ "Content-Type": "application/json", "X-Katha-Platform": "web" });
  for (const name of ["user-agent", "accept-language", "x-forwarded-for", "cf-ipcountry", "cloudfront-viewer-country", "x-katha-country"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

/** POST to the API, or null when it cannot be reached at all (DNS, refused, timeout). */
export async function postApi(
  request: NextRequest,
  path: string,
  body: unknown,
  extra: Record<string, string> = {},
  timeoutMs = 10_000,
): Promise<Response | null> {
  const headers = forwardedHeaders(request);
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  try {
    return await fetch(`${API_ORIGIN}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return null;
  }
}

export const unreachable = () => apiError(502, "upstream_unavailable", "Could not reach the sign-in service. Try again.");

/** What the API's TokenPair looks like once it has been parsed; only what the handlers read. */
export type TokenPair = { access_token: string; refresh_token: string; expires_in: number; is_new_user?: boolean };

/** Hands the page the access token only; the refresh token goes in the cookie, and nowhere else. */
export function tokenResponse(request: NextRequest, pair: TokenPair): NextResponse {
  const res = NextResponse.json(
    { access_token: pair.access_token, expires_in: pair.expires_in, is_new_user: pair.is_new_user ?? false },
    { headers: { "Cache-Control": "no-store" } },
  );
  res.cookies.set({
    name: REFRESH_COOKIE,
    value: pair.refresh_token,
    httpOnly: true,
    secure: isHttps(request),
    sameSite: "lax",
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_COOKIE_MAX_AGE,
  });
  return res;
}

export function clearRefreshCookie(request: NextRequest, res: NextResponse): NextResponse {
  res.cookies.set({
    name: REFRESH_COOKIE,
    value: "",
    httpOnly: true,
    secure: isHttps(request),
    sameSite: "lax",
    path: REFRESH_COOKIE_PATH,
    maxAge: 0,
  });
  res.headers.set("Cache-Control", "no-store");
  return res;
}

/** Copies an API error through unchanged, so the browser sees the code and message the API chose. */
export async function passThrough(upstream: Response): Promise<NextResponse> {
  const text = await upstream.text();
  return new NextResponse(text || JSON.stringify({ detail: { code: "error", message: `Request failed (${upstream.status})` } }), {
    status: upstream.status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
