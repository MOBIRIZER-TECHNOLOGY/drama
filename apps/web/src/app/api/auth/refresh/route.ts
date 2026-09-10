import type { NextRequest } from "next/server";
import { apiError, clearRefreshCookie, passThrough, postApi, REFRESH_COOKIE, rejectCrossSite, tokenResponse, unreachable, type TokenPair } from "../_bff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Rotate: presents the cookie's refresh token to /v1/auth/refresh, stores the new one and hands back the new
 * access token. A 401 from the API means the session is gone (expired, revoked, or the token was already
 * rotated — the reuse alarm), so the cookie goes too and the page signs out.
 */
export async function POST(request: NextRequest) {
  const refused = rejectCrossSite(request);
  if (refused) return refused;

  const refresh = request.cookies.get(REFRESH_COOKIE)?.value;
  if (!refresh) return clearRefreshCookie(request, apiError(401, "no_session", "Please sign in to continue."));

  const upstream = await postApi(request, "/v1/auth/refresh", { refresh_token: refresh });
  if (!upstream) return unreachable();
  if (upstream.status === 401 || upstream.status === 403) {
    return clearRefreshCookie(request, await passThrough(upstream));
  }
  if (!upstream.ok) return passThrough(upstream);
  const pair = (await upstream.json()) as TokenPair;
  return tokenResponse(request, pair);
}

