"use client";

import type { components } from "@katha/api-client";

/**
 * The browser side of the auth BFF (src/app/api/auth). Sign-in, refresh and sign-out go to this origin,
 * which keeps the refresh token in an httpOnly cookie and hands the page the short-lived access token only.
 *
 * Every call is a same-origin JSON POST: that is what the handlers' CSRF check requires, and `credentials`
 * is "same-origin" so the cookie rides along without ever being readable here.
 */

export type ExchangeBody = Omit<components["schemas"]["ExchangeRequest"], "platform">;

/** What the handlers return: the API's TokenPair minus the refresh token. */
export type AccessGrant = { access_token: string; expires_in: number; is_new_user: boolean };

/** Shaped like an openapi-fetch result so `call()` from ./errors normalises BFF errors the same way. */
export type BffResult<T> = { data?: T; error?: unknown; response: Response };

async function post<T>(path: string, body: unknown, headers: Record<string, string> = {}): Promise<BffResult<T>> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body ?? {}),
  });
  const text = await response.text();
  let parsed: unknown = undefined;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = undefined;
  }
  return response.ok ? { data: parsed as T, response } : { error: parsed ?? { detail: `Request failed (${response.status})` }, response };
}

export const authBff = {
  exchange: (body: ExchangeBody) => post<AccessGrant>("/api/auth/exchange", body),
  /** Raw response on purpose: the token store tells 401 (session gone) apart from a transient failure. */
  refresh: () =>
    fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }),
  logout: (accessToken: string | null) =>
    post<{ ok: true }>("/api/auth/logout", {}, accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
};
