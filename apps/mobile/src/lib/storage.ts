import AsyncStorage from "@react-native-async-storage/async-storage";

const KEYS = {
  language: "katha.language",
  onboarded: "katha.onboarded",
  autoUnlock: "katha.auto_unlock",
  muted: "katha.shorts_muted",
  subtitles: "katha.subtitles",
  configCache: "katha.config_cache",
} as const;

export type StorageKey = keyof typeof KEYS;
/** Dynamic keys (e.g. `messages:hi`) are namespaced under the app prefix. */
type AnyKey = StorageKey | `messages:${string}`;

function resolve(key: AnyKey): string {
  return key in KEYS ? KEYS[key as StorageKey] : `katha.${key}`;
}

export async function getItem(key: AnyKey): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(resolve(key));
  } catch {
    return null;
  }
}

export async function setItem(key: AnyKey, value: string | null): Promise<void> {
  try {
    if (value === null) await AsyncStorage.removeItem(resolve(key));
    else await AsyncStorage.setItem(resolve(key), value);
  } catch {
    // best effort
  }
}

export async function getBool(key: StorageKey, fallback = false): Promise<boolean> {
  const v = await getItem(key);
  return v === null ? fallback : v === "1";
}

export function setBool(key: StorageKey, value: boolean): Promise<void> {
  return setItem(key, value ? "1" : "0");
}

export async function getJson<T>(key: AnyKey): Promise<T | null> {
  const raw = await getItem(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Drop the cached remote config and translation bundles. Preferences (language, onboarding, auto-unlock,
 * mute, subtitles) and the secure-store tokens are deliberately kept: this is a cache reset, not a sign-out.
 */
export async function clearCaches(): Promise<number> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const doomed = keys.filter((k) => k === KEYS.configCache || k.startsWith("katha.messages:"));
    if (doomed.length) await AsyncStorage.multiRemove(doomed);
    return doomed.length;
  } catch {
    return 0;
  }
}

export function setJson(key: AnyKey, value: unknown): Promise<void> {
  try {
    return setItem(key, JSON.stringify(value));
  } catch {
    return Promise.resolve();
  }
}
