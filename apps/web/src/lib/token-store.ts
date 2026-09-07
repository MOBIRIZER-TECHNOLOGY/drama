import type { TokenStore } from "@katha/api-client";
import { API_URL } from "./api";

const KEY = "katha.tokens";
const DEVICE_KEY = "katha.device_id";
const LOCK_NAME = "katha.refresh";
const SKEW_MS = 30_000;

export type StoredTokens = { access_token: string; refresh_token: string; expires_at: number };

type Listener = (tokens: StoredTokens | null) => void;

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
    memory = raw ? (JSON.parse(raw) as StoredTokens) : null;
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
  listeners.forEach((fn) => fn(tokens));
}

async function refreshUnlocked(before: StoredTokens): Promise<string | null> {
  // Another tab may have refreshed while we waited for the lock: reuse its newer token.
  const latest = readStorage();
  if (!latest) return null;
  if (latest.refresh_token !== before.refresh_token || latest.expires_at > before.expires_at) return latest.access_token;
  try {
    const res = await fetch(`${API_URL}/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Katha-Platform": "web" },
      body: JSON.stringify({ refresh_token: latest.refresh_token }),
    });
    if (res.status === 401 || res.status === 403) {
      write(null);
      return null;
    }
    if (!res.ok) return latest.access_token; // transient server error: keep what we have
    const pair = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
    tokenStore.set(pair);
    return pair.access_token;
  } catch {
    return latest.access_token; // offline: let the request fail on its own
  }
}

async function refresh(): Promise<string | null> {
  if (refreshing) return refreshing;
  const current = read();
  if (!current?.refresh_token) return null;
  const run = () => refreshUnlocked(current);
  // Web Locks serialise refreshes across tabs so a rotated refresh token is never used twice.
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  // lib.dom types the lock callback result as a nested promise; `await` flattens it.
  const pending: Promise<string | null> = locks ? (async () => await locks.request(LOCK_NAME, run))() : run();
  refreshing = pending.finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export const tokenStore: TokenStore & {
  set(pair: { access_token: string; refresh_token: string; expires_in: number }): void;
  clear(): void;
  has(): boolean;
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
  set(pair) {
    write({
      access_token: pair.access_token,
      refresh_token: pair.refresh_token,
      expires_at: Date.now() + Math.max(60, pair.expires_in) * 1000,
    });
  },
  clear() {
    write(null);
  },
  has() {
    return !!read();
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
      listeners.forEach((fn) => fn(read()));
    }
  });
}
