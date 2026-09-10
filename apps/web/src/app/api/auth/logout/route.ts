import { NextResponse, type NextRequest } from "next/server";
import { clearRefreshCookie, postApi, REFRESH_COOKIE, rejectCrossSite, type TokenPair } from "../_bff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sign-out. The cookie is cleared whatever happens; revoking the session at the API is best-effort, so a
 * sign-out never fails because the API was slow. The page passes its access token as the bearer; when that
 * has expired the cookie can still buy a fresh one to revoke with, so "sign out" ends the session row rather
 * than leaving it alive for the refresh token's remaining life.
 */
export async function POST(request: NextRequest) {
  const refused = rejectCrossSite(request);
  if (refused) return refused;

  const refresh = request.cookies.get(REFRESH_COOKIE)?.value;
  const bearer = request.headers.get("authorization");

  let revoked = false;
  if (bearer) {
    const res = await postApi(request, "/v1/auth/logout", {}, { Authorization: bearer }, 5_000);
    revoked = !!res && res.status !== 401;
  }
  if (!revoked && refresh) {
    const rotated = await postApi(request, "/v1/auth/refresh", { refresh_token: refresh }, {}, 5_000);
    if (rotated?.ok) {
      const pair = (await rotated.json()) as TokenPair;
      await postApi(request, "/v1/auth/logout", {}, { Authorization: `Bearer ${pair.access_token}` }, 5_000);
    }
  }

  return clearRefreshCookie(request, NextResponse.json({ ok: true }));
}
