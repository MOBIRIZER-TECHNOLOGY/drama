import type { TokenStore } from "@katha/api-client";
import { authBff } from "./auth-bff";

const KEY = "katha.tokens";
const DEVICE_KEY = "katha.device_id";
const LOCK_NAME = "katha.refresh";
const SKEW_MS = 30_000;

export type StoredTokens = { access_token: string; expires_at: number };

/**
 * Where a change came from. "local" is this tab writing (sign-in, refresh, sign-out); "storage" is another
 * tab's write arriving through the `storage` event, which is the only way this tab learns it was signed in
 * or out elsewhere.
 */
export type TokenChangeSource = "local" | "storage";

type Listener = (tokens: StoredTokens | null, source: TokenChangeSource) => void;

/*
 * What is stored here, and what is not.
 *
 * Only the access token and its expiry. It is fifteen minutes of access and it has to be readable by script,
 * because every API call attaches it as a bearer header to a different origin. The refresh token — the
 * 30-day one — is not here: the auth BFF on this origin (src/app/api/auth) keeps it in an httpOnly cookie
 * scoped to `/api/auth`, and this store asks that route for a new access token when the old one runs out.
 * A script that reads localStorage now gets a quarter of an hour, not a month, and the nonce CSP
 * (src/lib/csp.ts) is what makes that script hard to run in the first place.
 *
 * localStorage rather than memory so the session survives a reload and, through the `storage` event, so
 * a sign-in or sign-out in one tab reaches the others. Earlier builds stored the refresh token alongside;
 * `readStorage` drops it from anything it finds so a returning browser does not keep one around.
 */

const listeners = new Set<Listener>();
let memory: StoredTokens | null | undefined;
let refreshing: Promise<string | null> | null = null;

function hasWindow(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function read(): StoredTokens | null {
  if (memory !== undefined) return memory;
  return readStorage();
}

/** Always hits localStorage (used inside the refresh lock, where another tab may have rotated the tokens). */
function readStorage(): StoredTokens | null {
  if (!hasWindow()) return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<StoredTokens> & { refresh_token?: unknown }) : null;
    if (!parsed || typeof parsed.access_token !== "string" || typeof parsed.expires_at !== "number") {
      memory = null;
      if (raw) window.localStorage.removeItem(KEY);
    } else {
      memory = { access_token: parsed.access_token, expires_at: parsed.expires_at };
      // Legacy shape from before the BFF: the refresh token was stored next to the access token. Rewrite
      // without it, so the only copy that outlives this load is the cookie (which this browser may not have,
      // in which case the session simply ends when the access token does).
      if ("refresh_token" in parsed) window.localStorage.setItem(KEY, JSON.stringify(memory));
    }
  } catch {
    memory = null;
  }
  return memory;
}

function write(tokens: StoredTokens | null): void {
  memory = tokens;
  if (hasWindow()) {
    try {
      if (tokens) window.localStorage.setItem(KEY, JSON.stringify(tokens));
      else window.localStorage.removeItem(KEY);
    } catch {
      /* storage unavailable (private mode); memory copy still works for this tab */
    }
  }
  listeners.forEach((fn) => fn(tokens, "local"));
}

async function refreshUnlocked(before: StoredTokens): Promise<string | null> {
  // Another tab may have refreshed while we waited for the lock: reuse its newer token.
  const latest = readStorage();
  if (!latest) return null;
  if (latest.expires_at > before.expires_at) return latest.access_token;
  try {
    const res = await authBff.refresh();
    if (res.status === 401 || res.status === 403) {
      // The BFF has already dropped the cookie; drop the access token so the app signs out everywhere.
      write(null);
      return null;
    }
    if (!res.ok) return latest.access_token; // transient server error: keep what we have
    const grant = (await res.json()) as { access_token: string; expires_in: number };
    tokenStore.set(grant);
    return grant.access_token;
  } catch {
    return latest.access_token; // offline: let the request fail on its own
  }
}

/**
 * Ask the BFF for a new access token. Single-flight within the tab; Web Locks serialise refreshes across
 * tabs so a rotated refresh token is never presented twice (the API treats a reuse as theft and revokes the
 * whole session). Without a stored access token there is no session to refresh from this tab's point of
 * view, so it answers null rather than probing the cookie on every anonymous page view.
 */
async function refresh(): Promise<string | null> {
  if (refreshing) return refreshing;
  const current = read();
  if (!current) return null;
  const run = () => refreshUnlocked(current);
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  // lib.dom types the lock callback result as a nested promise; `await` flattens it.
  const pending: Promise<string | null> = locks ? (async () => await locks.request(LOCK_NAME, run))() : run();
  refreshing = pending.finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export const tokenStore: TokenStore & {
  set(grant: { access_token: string; expires_in: number }): void;
  clear(): void;
  has(): boolean;
  /** The stored access token as-is, expired or not; sign-out sends it so the API can revoke the session. */
  current(): string | null;
  subscribe(fn: Listener): () => void;
  deviceId(): string;
} = {
  async getAccessToken() {
    const t = read();
    if (!t) return null;
    if (t.expires_at - SKEW_MS > Date.now()) return t.access_token;
    return refresh();
  },
  refresh,
  set(grant) {
    write({
      access_token: grant.access_token,
      expires_at: Date.now() + Math.max(60, grant.expires_in) * 1000,
    });
  },
  clear() {
    write(null);
  },
  has() {
    return !!read();
  },
  current() {
    return read()?.access_token ?? null;
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  deviceId() {
    if (!hasWindow()) return "server";
    try {
      let id = window.localStorage.getItem(DEVICE_KEY);
      if (!id) {
        id = typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : `web-${Date.now().toString(36)}`;
        window.localStorage.setItem(DEVICE_KEY, id);
      }
      return id;
    } catch {
      return "web";
    }
  },
};

if (hasWindow()) {
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) {
      memory = undefined;
      listeners.forEach((fn) => fn(read(), "storage"));
    }
  });
}
