import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { createKathaClient, type TokenStore } from "@katha/api-client";
import { getDeviceCountry } from "@/lib/device";

const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string; appEnv?: string };

export const baseUrl: string = process.env.EXPO_PUBLIC_API_URL ?? extra.apiUrl ?? "http://10.0.2.2:8000";

/**
 * Hosts that cannot be reached from outside the network the device is on: loopback, the RFC 1918 ranges,
 * link-local, and the emulator's alias for its host. Plaintext to one of these is a build wired to a machine
 * on the same LAN — there is no path over which a stranger could read it.
 */
function isPrivateHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "::1" || hostname.endsWith(".local")) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

// A shipped build must never talk to a plaintext API: fail fast at startup rather than put every token on the
// wire in the clear. The check is on reachability rather than on the build variant, because the thing that
// leaks is plaintext crossing the internet — a build pointed at a private address is someone testing against
// their own machine, and refusing that only pushes them towards weakening the check for the real case too.
// A store build aimed at a public host over http still refuses, which is the case this exists for.
if (!__DEV__ && !baseUrl.startsWith("https://")) {
  const host = (() => {
    try {
      return new URL(baseUrl).hostname;
    } catch {
      return "";
    }
  })();
  if (!isPrivateHost(host)) {
    throw new Error(`Refusing to start: API base URL must use https outside a private network (got ${baseUrl}).`);
  }
}

export const platform: "android" | "ios" = Platform.OS === "ios" ? "ios" : "android";

const ACCESS_KEY = "katha.access_token";
const REFRESH_KEY = "katha.refresh_token";
const REFRESH_TIMEOUT_MS = 8000;

type Pair = { access_token: string; refresh_token: string };
type Listener = () => void;

let accessToken: string | null = null;
let refreshToken: string | null = null;
let loaded: Promise<void> | null = null;
let refreshing: Promise<string | null> | null = null;
const signOutListeners = new Set<Listener>();

async function secureGet(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function secureSet(key: string, value: string | null): Promise<void> {
  try {
    if (value === null) await SecureStore.deleteItemAsync(key);
    else await SecureStore.setItemAsync(key, value);
  } catch {
    // Secure storage unavailable (e.g. simulator without keychain): tokens stay in memory only.
  }
}

/**
 * Token store backed by expo-secure-store with an in-memory cache and single-flight refresh.
 * Tokens are cleared only when the refresh endpoint itself rejects the refresh token (401/403);
 * network failures and timeouts keep the session so the user is not logged out by a bad connection.
 */
export const tokens: TokenStore & {
  load(): Promise<void>;
  set(pair: Pair): Promise<void>;
  clear(): Promise<void>;
  hasSession(): boolean;
  getRefreshToken(): string | null;
  onSignedOut(listener: Listener): () => void;
} = {
  load() {
    if (!loaded) {
      loaded = (async () => {
        const [a, r] = await Promise.all([secureGet(ACCESS_KEY), secureGet(REFRESH_KEY)]);
        accessToken = a;
        refreshToken = r;
      })();
    }
    return loaded;
  },
  getAccessToken: () => accessToken,
  getRefreshToken: () => refreshToken,
  hasSession: () => refreshToken !== null,
  async refresh() {
    if (!refreshToken) return null;
    if (!refreshing) {
      refreshing = (async () => {
        try {
          const res = await fetch(`${baseUrl}/v1/auth/refresh`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Katha-Platform": platform },
            body: JSON.stringify({ refresh_token: refreshToken }),
            signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
          });
          if (!res.ok) {
            if (res.status === 401 || res.status === 403) {
              await tokens.clear();
              signOutListeners.forEach((l) => l());
            }
            return null;
          }
          const pair = (await res.json()) as Pair;
          await tokens.set(pair);
          return pair.access_token;
        } catch {
          return null;
        } finally {
          refreshing = null;
        }
      })();
    }
    return refreshing;
  },
  async set(pair) {
    accessToken = pair.access_token;
    refreshToken = pair.refresh_token;
    await Promise.all([secureSet(ACCESS_KEY, pair.access_token), secureSet(REFRESH_KEY, pair.refresh_token)]);
  },
  async clear() {
    accessToken = null;
    refreshToken = null;
    await Promise.all([secureSet(ACCESS_KEY, null), secureSet(REFRESH_KEY, null)]);
  },
  onSignedOut(listener) {
    signOutListeners.add(listener);
    return () => {
      signOutListeners.delete(listener);
    };
  },
};

/** Device region for store pricing and offer eligibility (`X-Katha-Country`); `"*"` when the OS reports none. */
export const country: string = getDeviceCountry() ?? "*";

/** Adds the region header to every request; the API reads `x-katha-country` when no CDN geo header is present. */
function fetchWithCountry(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = input instanceof Request && init === undefined ? input : new Request(input, init);
  if (country !== "*") {
    try {
      request.headers.set("X-Katha-Country", country);
    } catch {
      // immutable headers (should not happen for requests we build); the query param still carries the region
    }
  }
  return fetch(request);
}

export const api = createKathaClient({ baseUrl, platform, tokens, fetch: fetchWithCountry });
