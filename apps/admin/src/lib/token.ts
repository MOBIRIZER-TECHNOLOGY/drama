import type { TokenStore } from "@katha/api-client";

/** Admin JWT lives in localStorage (for the client) and a cookie (for the proxy's optimistic redirect). */
export const TOKEN_KEY = "katha_admin_token";

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
    /* storage unavailable: cookie still carries the session */
  }
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${TOKEN_KEY}=${encodeURIComponent(token)}; path=/; max-age=${expiresInSec}; SameSite=Lax${secure}`;
}

export function clearToken() {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
  document.cookie = `${TOKEN_KEY}=; path=/; max-age=0; SameSite=Lax`;
}

/** No refresh endpoint for admin tokens: a 401 means sign in again. */
export const tokenStore: TokenStore = {
  getAccessToken: () => getToken(),
};
