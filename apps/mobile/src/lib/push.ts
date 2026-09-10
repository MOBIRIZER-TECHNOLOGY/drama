import { isRunningInExpoGo } from "expo";
import Constants from "expo-constants";
import * as Device from "expo-device";
import type * as ExpoNotifications from "expo-notifications";
import { Platform } from "react-native";
import { api } from "./api";
import { getJson, setJson } from "./storage";

/**
 * Push registration.
 *
 * The retention loop is entirely server-side (streak reminders, new-episode alerts, resume nudges) and none of
 * it can reach anyone without a token on the session row. This asks for permission, resolves an Expo token, and
 * registers it against the current session.
 *
 * Two deliberate choices:
 *
 *  - Permission is never requested at launch. Android 13+ shows a system dialog that most people decline on
 *    sight, and a declined permission cannot be re-requested. `ensureRegistered` only runs when a caller has
 *    earned the ask — after a check-in claim, or from an explicit settings toggle.
 *  - The token is cached locally so a warm start does not re-hit the API. The server treats a repeat
 *    registration as idempotent anyway; this just avoids the request. The cache is keyed on the account it
 *    was registered for: the token belongs to a device, but the registration belongs to a session, and the
 *    same device signing into a second account must register again rather than trust the first one's cache.
 */

const TOKEN_KEY = "pushToken";
const ASKED_KEY = "pushAsked";

/** What the cache holds: the token, and the user it was registered for. */
type CachedRegistration = { token: string; owner: string | null };

/** Reads the cache, treating the pre-owner string format as absent so it re-registers once. */
async function cachedRegistration(): Promise<CachedRegistration | null> {
  const cached = await getJson<CachedRegistration | string>(TOKEN_KEY);
  if (!cached || typeof cached === "string") return null;
  return cached;
}

/**
 * expo-notifications is loaded on demand, never with a static import.
 *
 * Its entry point runs side effects while it evaluates: `DevicePushTokenAutoRegistration.fx` subscribes a
 * device-token listener at module scope, and on a build where that is unsupported the subscription throws
 * during the import itself. A `try` inside this file cannot catch that, because the throw happens before any
 * of this code exists, so the module object came back undefined and every screen importing it went down too,
 * the root layout included. The whole app rendered nothing because an optional subsystem was unavailable.
 *
 * Requiring it here moves that failure inside a `try`, and caching the answer means an unsupported build pays
 * for one failed require rather than one per call. Push is optional. The app is not.
 */
type NotificationsModule = typeof ExpoNotifications;

let loaded: NotificationsModule | null | undefined;

function notifications(): NotificationsModule | null {
  if (loaded !== undefined) return loaded;
  // Expo Go on Android is a documented no-push host, and its throw happens inside Metro's own module guard,
  // which reports it as a fatal error before this catch ever runs. Skipping the require keeps the dev client
  // usable instead of red-boxing on every reload; the catch below still covers every other build.
  if (isRunningInExpoGo() && Platform.OS === "android") {
    loaded = null;
    return loaded;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    loaded = require("expo-notifications") as NotificationsModule;
  } catch {
    loaded = null;
  }
  return loaded;
}

/** Runs `fn` against the module, returning `fallback` when it is unavailable or the call throws. */
function guard<T>(fn: (n: NotificationsModule) => T, fallback: T): T {
  const n = notifications();
  if (!n) return fallback;
  try {
    return fn(n);
  } catch {
    return fallback;
  }
}

/** Whether this build can do push at all. Callers use it to hide the affordance rather than fail on tap. */
export function pushAvailable(): boolean {
  return notifications() !== null;
}

/**
 * Installs the foreground presentation handler.
 *
 * Called explicitly rather than on import: a side effect that runs at module scope is exactly what made this
 * module dangerous to import in the first place.
 */
export function installNotificationHandler(): void {
  guard(
    (n) =>
      n.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
        }),
      }),
    undefined,
  );
}

/** Android requires a channel before anything is delivered; without one notifications are silently dropped. */
export async function configureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await guard(
    (n) =>
      n.setNotificationChannelAsync("default", {
        name: "Katha",
        importance: n.AndroidImportance.DEFAULT,
        vibrationPattern: [0, 250, 250, 250],
        lockscreenVisibility: n.AndroidNotificationVisibility.PUBLIC,
      }),
    Promise.resolve(null),
  );
}

export async function hasAskedForPush(): Promise<boolean> {
  return (await getJson<boolean>(ASKED_KEY)) === true;
}

/** Current OS-level permission, without prompting. */
export async function pushPermission(): Promise<"granted" | "denied" | "undetermined"> {
  const result = await guard<Promise<ExpoNotifications.NotificationPermissionsStatus | null>>(
    (n) => n.getPermissionsAsync(),
    Promise.resolve(null),
  );
  // No module means no permission to report, and the settings toggle reads that as off rather than breaking.
  return (result?.status ?? "denied") as "granted" | "denied" | "undetermined";
}

/**
 * Ask if needed, resolve a token, and register it. Returns whether the device can now receive push.
 *
 * `owner` is the signed-in user's id; the cached registration only counts when it was made for the same
 * account. Safe to call repeatedly. Never throws: a push failure must not break the flow that triggered it.
 */
export async function ensureRegistered({ prompt = true, owner = null }: { prompt?: boolean; owner?: string | null } = {}): Promise<boolean> {
  try {
    // A simulator has no push service, and asking there only produces a confusing failure.
    if (!Device.isDevice) return false;
    if (!pushAvailable()) return false;

    let status = await pushPermission();
    if (status !== "granted") {
      if (!prompt) return false;
      await setJson(ASKED_KEY, true);
      const asked = await guard<Promise<ExpoNotifications.NotificationPermissionsStatus | null>>(
        (n) => n.requestPermissionsAsync(),
        Promise.resolve(null),
      );
      status = (asked?.status ?? "denied") as typeof status;
    }
    if (status !== "granted") return false;

    await configureAndroidChannel();
    // Outside EAS Build the project id is not injected, and getExpoPushTokenAsync then throws rather than
    // returning a token. Read it explicitly so a missing id is a clean "push unavailable", not a crash.
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;
    if (!projectId) return false;
    const issued = await guard<Promise<ExpoNotifications.ExpoPushToken | null>>(
      (n) => n.getExpoPushTokenAsync({ projectId }),
      Promise.resolve(null),
    );
    const token = issued?.data;
    if (!token) return false;

    const cached = await cachedRegistration();
    if (cached?.token === token && cached.owner === owner) return true;

    const { error } = await api.PUT("/v1/auth/me/push-token", { body: { token } });
    if (error) return false;
    await setJson(TOKEN_KEY, { token, owner } satisfies CachedRegistration);
    return true;
  } catch {
    return false;
  }
}

/**
 * Stop delivery to this device. Used by the notifications toggle in settings and on sign-out.
 *
 * Best effort, and always clears the local cache: on sign-out the next account on this device must register
 * afresh even when the DELETE never reached the server.
 */
export async function unregister(): Promise<void> {
  try {
    await api.DELETE("/v1/auth/me/push-token");
  } catch {
    /* the session may already be gone; the token dies with it */
  }
  await setJson(TOKEN_KEY, null);
}

/**
 * The last notification tap, and a subscription to future ones.
 *
 * Wrapped here so `PushRouter` never touches the module directly: it runs inside the navigator, where a throw
 * unmounts the app rather than merely losing a notification tap.
 */
export function lastNotificationResponse(): ExpoNotifications.NotificationResponse | null {
  return guard<ExpoNotifications.NotificationResponse | null>((n) => n.getLastNotificationResponse(), null);
}

export function clearLastNotificationResponse(): void {
  guard((n) => n.clearLastNotificationResponse(), undefined);
}

export function onNotificationResponse(listener: (response: ExpoNotifications.NotificationResponse) => void): () => void {
  const sub = guard<ExpoNotifications.EventSubscription | null>((n) => n.addNotificationResponseReceivedListener(listener), null);
  return () => sub?.remove();
}

/** Where a notification wants the app to go. Mirrors the `data` the worker sends. */
export type PushRoute = { pathname: string; params?: Record<string, string> } | null;

export function routeFor(data: Record<string, unknown> | undefined): PushRoute {
  if (!data) return null;
  const route = typeof data.route === "string" ? data.route : null;
  const seriesId = typeof data.series_id === "string" ? data.series_id : null;

  if (seriesId) {
    const episode = typeof data.episode === "number" ? String(data.episode) : undefined;
    return { pathname: "/series/[id]", params: { id: seriesId, ...(episode ? { episode } : {}) } };
  }
  if (route === "rewards") return { pathname: "/rewards" };
  if (route === "wallet") return { pathname: "/wallet" };
  return null;
}
