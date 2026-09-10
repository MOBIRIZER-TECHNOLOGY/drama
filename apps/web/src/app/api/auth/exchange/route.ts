import type { NextRequest } from "next/server";
import { apiError, passThrough, postApi, rejectCrossSite, tokenResponse, unreachable, type TokenPair } from "../_bff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sign-in: forwards the Firebase ID token (and the device fields the page collects) to the API's
 * /v1/auth/exchange, keeps the refresh token in the httpOnly cookie and returns the access token only.
 * See ../_bff.ts for the cookie and the CSRF posture.
 */
export async function POST(request: NextRequest) {
  const refused = rejectCrossSite(request);
  if (refused) return refused;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return apiError(400, "bad_request", "Expected a JSON body");
  }
  if (!body || typeof body !== "object" || typeof body.firebase_id_token !== "string") {
    return apiError(400, "bad_request", "firebase_id_token is required");
  }

  // The platform is what this origin is, not what the page says it is; the rest is the API's to validate.
  const upstream = await postApi(request, "/v1/auth/exchange", { ...body, platform: "web" }, {}, 15_000);
  if (!upstream) return unreachable();
  if (!upstream.ok) return passThrough(upstream);
  const pair = (await upstream.json()) as TokenPair;
  return tokenResponse(request, pair);
}
