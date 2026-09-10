import type { TokenStore } from "@katha/api-client";
import { decodeJwt } from "jose";

/**
 * The admin JWT lives in localStorage only. The proxy's optimistic redirect used to read the same token from a
 * cookie, which meant a bearer credential travelled on every request and sat where any script on the page
 * could read it. The proxy only ever needed two claims — when the token expires and which role holds it — so
 * that is all the cookie carries now: `{exp, role}` as JSON, useless to anyone who steals it.
 */
export const TOKEN_KEY = "katha_admin_token";
export const SESSION_COOKIE = "katha_admin_session";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string, expiresInSec: number) {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* storage unavailable: the next API call has no token and the 401 sends the admin back to /login */
  }
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  const session = encodeURIComponent(JSON.stringify(sessionClaims(token, expiresInSec)));
  document.cookie = `${SESSION_COOKIE}=${session}; path=/; max-age=${expiresInSec}; SameSite=Lax${secure}`;
}

export function clearToken() {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
  document.cookie = `${SESSION_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
  // Earlier builds kept the JWT itself in a cookie under the token key; clear it too so a sign-out is complete.
  document.cookie = `${TOKEN_KEY}=; path=/; max-age=0; SameSite=Lax`;
}

/** The two claims the proxy gates on. Decoded, not verified: the API verifies the signature on every call. */
function sessionClaims(token: string, expiresInSec: number): { exp: number; role: unknown } {
  const fallbackExp = Math.floor(Date.now() / 1000) + expiresInSec;
  try {
    const payload = decodeJwt(token);
    return { exp: payload.exp ?? fallbackExp, role: (payload as { role?: unknown }).role };
  } catch {
    return { exp: fallbackExp, role: undefined };
  }
}

/** No refresh endpoint for admin tokens: a 401 means sign in again. */
export const tokenStore: TokenStore = {
  getAccessToken: () => getToken(),
};
