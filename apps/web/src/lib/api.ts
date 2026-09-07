import { createKathaClient } from "@katha/api-client";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");

/** Server-side / anonymous client. Browser code uses `clientApi` from ./client-api which carries the token store. */
export const api = createKathaClient({ baseUrl: API_URL, platform: "web" });

export const REQUEST_TIMEOUT_MS = 6000;

export function timeoutSignal(ms: number = REQUEST_TIMEOUT_MS): AbortSignal {
  return AbortSignal.timeout(ms);
}
