import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
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
 *    registration as idempotent anyway; this just avoids the request.
 */

const TOKEN_KEY = "pushToken";
const ASKED_KEY = "pushAsked";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** Android requires a channel before anything is delivered; without one notifications are silently dropped. */
export async function configureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("default", {
    name: "Katha",
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 250, 250, 250],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

export async function hasAskedForPush(): Promise<boolean> {
  return (await getJson<boolean>(ASKED_KEY)) === true;
}

/** Current OS-level permission, without prompting. */
export async function pushPermission(): Promise<"granted" | "denied" | "undetermined"> {
  const { status } = await Notifications.getPermissionsAsync();
  return status as "granted" | "denied" | "undetermined";
}

/**
 * Ask if needed, resolve a token, and register it. Returns whether the device can now receive push.
 *
 * Safe to call repeatedly. Never throws: a push failure must not break the flow that triggered it.
 */
export async function ensureRegistered({ prompt = true }: { prompt?: boolean } = {}): Promise<boolean> {
  try {
    // A simulator has no push service, and asking there only produces a confusing failure.
    if (!Device.isDevice) return false;

    let { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") {
      if (!prompt) return false;
      await setJson(ASKED_KEY, true);
      ({ status } = await Notifications.requestPermissionsAsync());
    }
    if (status !== "granted") return false;

    await configureAndroidChannel();
    // Outside EAS Build the project id is not injected, and getExpoPushTokenAsync then throws rather than
    // returning a token. Read it explicitly so a missing id is a clean "push unavailable", not a crash.
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;
    if (!projectId) return false;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!token) return false;

    const cached = await getJson<string>(TOKEN_KEY);
    if (cached === token) return true;

    const { error } = await api.PUT("/v1/auth/me/push-token", { body: { token } });
    if (error) return false;
    await setJson(TOKEN_KEY, token);
    return true;
  } catch {
    return false;
  }
}

/** Stop delivery to this device. Used by the notifications toggle in settings and on sign-out. */
export async function unregister(): Promise<void> {
  try {
    await api.DELETE("/v1/auth/me/push-token");
  } catch {
    /* the session may already be gone; the token dies with it */
  }
  await setJson(TOKEN_KEY, null);
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
