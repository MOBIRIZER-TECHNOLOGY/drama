import * as Crypto from "expo-crypto";
import * as Network from "expo-network";
import { AppState, Platform, type AppStateStatus } from "react-native";
import { api, baseUrl, platform, tokens } from "@/lib/api";
import { getDeviceModel, getMarketingVersion, getOsVersion, getRamGb, getVersionCode } from "@/lib/device";

/**
 * Product and QoE beacons, batched to `POST /v1/events`.
 *
 * Events queue in memory and flush every 10 s or once 20 are waiting; when the app goes to the background the
 * queue is sent immediately with a keepalive fetch (honoured where the runtime supports it, ignored elsewhere).
 * Nothing here throws: analytics must never break a screen.
 */

/** Names accepted by the API (`services/api/app/api/routers/events.py: ALLOWED`); anything else is dropped server-side. */
export type ProductEvent =
  | "app_open"
  | "screen_view"
  | "series_view"
  | "episode_view"
  | "unlock_view"
  | "unlock"
  | "paywall_view"
  | "checkout_start"
  | "checkout_return"
  | "search"
  | "share"
  | "signup"
  | "login"
  // Acquisition and activation: without these the install-to-first-play funnel cannot be measured.
  | "install"
  | "onboarding_start"
  | "onboarding_complete"
  | "first_play"
  | "first_paywall"
  | "deep_link_open"
  | "referral_share"
  | "referral_signup"
  | "unlock_bundle"
  | "paywall_dismiss"
  // Merchandising: which rail and which position earned the tap.
  | "rail_impression"
  | "card_click"
  | "shorts_swipe"
  | "shorts_watch_depth"
  | "shorts_exit"
  // Retention.
  | "checkin"
  | "task_claim"
  | "notification_open"
  | "notification_permission"
  | "series_complete"
  | "favorite_add"
  | "favorite_remove"
  // Health: client failures are invisible in server logs.
  | "client_error"
  | "offline";
export type QoeEvent = "play_start" | "first_frame" | "rebuffer" | "bitrate_switch" | "play_error" | "play_complete" | "play_pause" | "seek";
export type EventName = ProductEvent | QoeEvent;

type Primitive = string | number | boolean | null;
export type EventProps = Record<string, Primitive | undefined>;

type QueuedEvent = { name: EventName; ts: string; props: Record<string, Primitive> };

const FLUSH_INTERVAL_MS = 10_000;
const FLUSH_AT = 20;
/** The API caps a batch at 200 events; beyond twice that the oldest are dropped rather than growing unbounded offline. */
const BATCH_MAX = 200;
const QUEUE_MAX = 400;
const REQUEST_TIMEOUT_MS = 8000;

const sessionId = safeUuid();
let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let inflight: Promise<void> | null = null;
let started = false;
let networkType = "unknown";

function safeUuid(): string | null {
  try {
    return Crypto.randomUUID();
  } catch {
    return null;
  }
}

function cleanProps(props?: EventProps): Record<string, Primitive> {
  const out: Record<string, Primitive> = {};
  if (!props) return out;
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined) continue;
    if (typeof v === "number" && !Number.isFinite(v)) continue;
    out[k] = v;
  }
  return out;
}

/** Device block sent with every batch: `{model, os, os_version, ram_gb, network, app_version, version_code}`. */
export function deviceInfo(): Record<string, Primitive> {
  return {
    model: getDeviceModel(),
    os: Platform.OS,
    os_version: getOsVersion(),
    ram_gb: getRamGb(),
    network: networkType,
    app_version: getMarketingVersion(),
    version_code: getVersionCode(),
  };
}

function refreshNetworkType(): void {
  Network.getNetworkStateAsync()
    .then((state) => {
      networkType = String(state.type ?? "unknown").toLowerCase();
    })
    .catch(() => {});
}

function schedule(): void {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void flushAnalytics();
  }, FLUSH_INTERVAL_MS);
}

/** Queue one event. Safe to call before `startAnalytics()`; the batch simply waits for the first flush. */
export function track(name: EventName, props?: EventProps): void {
  queue.push({ name, ts: new Date().toISOString(), props: cleanProps(props) });
  if (queue.length > QUEUE_MAX) queue = queue.slice(queue.length - QUEUE_MAX);
  if (queue.length >= FLUSH_AT) void flushAnalytics();
  else schedule();
}

function takeBatch(): QueuedEvent[] {
  const batch = queue.slice(0, BATCH_MAX);
  queue = queue.slice(batch.length);
  return batch;
}

function requeue(batch: QueuedEvent[]): void {
  queue = [...batch, ...queue].slice(0, QUEUE_MAX);
}

/**
 * Send what is queued. `keepalive` uses a raw fetch so the request may outlive a backgrounding app; the typed
 * client (with token refresh) is used otherwise. Network failures put the batch back; 4xx responses drop it.
 */
export async function flushAnalytics(opts?: { keepalive?: boolean }): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (inflight) {
    await inflight;
    if (queue.length === 0) return;
  }
  if (queue.length === 0) return;
  const batch = takeBatch();
  const body = { events: batch, session_id: sessionId, device: deviceInfo() };
  inflight = (async () => {
    try {
      if (opts?.keepalive) {
        // The store's getter is synchronous today, but TokenStore allows a promise: await covers both.
        const token = await tokens.getAccessToken();
        const res = await fetch(`${baseUrl}/v1/events`, {
          method: "POST",
          keepalive: true,
          headers: {
            "Content-Type": "application/json",
            "X-Katha-Platform": platform,
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!res.ok && res.status >= 500) requeue(batch);
        return;
      }
      const { response } = await api.POST("/v1/events", { body, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!response.ok && response.status >= 500) requeue(batch);
    } catch {
      requeue(batch);
    } finally {
      inflight = null;
    }
  })();
  await inflight;
  // More arrived while sending (or a large backlog): keep draining on the regular cadence.
  if (queue.length > 0) schedule();
}

function onAppState(state: AppStateStatus): void {
  if (state === "background" || state === "inactive") {
    void flushAnalytics({ keepalive: true });
  } else if (state === "active") {
    refreshNetworkType();
  }
}

/**
 * Wire the AppState flush and network probe, then record `app_open`. Idempotent; call once from the root layout.
 * Returns a disposer for completeness (the root layout never unmounts in practice).
 */
export function startAnalytics(): () => void {
  if (started) return () => {};
  started = true;
  refreshNetworkType();
  const netSub = Network.addNetworkStateListener((e) => {
    networkType = String(e.type ?? "unknown").toLowerCase();
  });
  const appSub = AppState.addEventListener("change", onAppState);
  track("app_open", { platform });
  return () => {
    started = false;
    netSub.remove();
    appSub.remove();
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

/** Session id sent with each batch (also useful for support logs). */
export function analyticsSessionId(): string | null {
  return sessionId;
}
