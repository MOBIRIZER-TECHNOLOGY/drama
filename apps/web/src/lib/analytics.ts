"use client";

import { clientApi } from "./client-api";

/**
 * Product and QoE beacons. Events are queued in memory and posted to `POST /v1/events` every 10 s or once 20 are
 * waiting, and flushed with `keepalive` when the page is hidden or unloaded. Everything is best-effort: a failed
 * batch is dropped (the API rate-limits at 120/min, so we never retry in a loop).
 */

export type EventProps = Record<string, string | number | boolean | null | undefined>;

type QueuedEvent = { name: string; ts: string; props: EventProps };

export const APP_VERSION = "web-0.1.0";
const SESSION_KEY = "katha.session_id";
const FLUSH_INTERVAL_MS = 10_000;
const FLUSH_AT = 20;
const MAX_BATCH = 200;

let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let listenersInstalled = false;

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // RFC 4122 v4 fallback for very old WebViews.
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

let memorySession: string | null = null;

/** Per-tab session id (sessionStorage), created on first use. */
export function sessionId(): string {
  if (memorySession) return memorySession;
  if (!hasWindow()) return (memorySession = uuid());
  try {
    let id = window.sessionStorage.getItem(SESSION_KEY);
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      id = uuid();
      window.sessionStorage.setItem(SESSION_KEY, id);
    }
    memorySession = id;
  } catch {
    memorySession = uuid();
  }
  return memorySession;
}

function osName(ua: string): string {
  if (/Android/i.test(ua)) return "Android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Mac OS/i.test(ua)) return "macOS";
  if (/CrOS/i.test(ua)) return "ChromeOS";
  if (/Linux/i.test(ua)) return "Linux";
  return "Web";
}

function browserName(ua: string): string {
  if (/Edg\//.test(ua)) return "Edge";
  if (/OPR\//.test(ua)) return "Opera";
  if (/SamsungBrowser\//.test(ua)) return "Samsung";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua)) return "Safari";
  return "Browser";
}

type NetworkInformation = { effectiveType?: string };

function device(): { os: string; model?: string; network?: string; app_version: string } {
  if (!hasWindow()) return { os: "server", app_version: APP_VERSION };
  const ua = navigator.userAgent;
  const conn = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  return {
    os: osName(ua),
    model: browserName(ua),
    network: conn?.effectiveType || undefined,
    app_version: APP_VERSION,
  };
}

function cleanProps(props: EventProps | undefined): EventProps {
  const out: EventProps = {};
  if (!props) return out;
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined) continue;
    if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v;
  }
  return out;
}

function send(events: QueuedEvent[], keepalive: boolean): void {
  if (events.length === 0) return;
  void clientApi
    .POST("/v1/events", {
      body: { events, session_id: sessionId(), device: device() },
      keepalive,
    })
    .catch(() => undefined);
}

/** Post everything queued so far. `keepalive` lets the request outlive a page unload. */
export function flush(keepalive = false): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (queue.length === 0) return;
  const batch = queue.slice(0, MAX_BATCH);
  queue = queue.slice(MAX_BATCH);
  send(batch, keepalive);
  if (queue.length) flush(keepalive);
}

function installListeners(): void {
  if (listenersInstalled || !hasWindow()) return;
  listenersInstalled = true;
  window.addEventListener("pagehide", () => flush(true));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush(true);
  });
}

/** Queue one event. Safe to call during SSR (no-op). */
export function track(name: string, props?: EventProps): void {
  if (!hasWindow()) return;
  installListeners();
  queue.push({ name, ts: new Date().toISOString(), props: cleanProps(props) });
  if (queue.length >= FLUSH_AT) {
    flush(false);
    return;
  }
  if (!timer) timer = setTimeout(() => flush(false), FLUSH_INTERVAL_MS);
}

/** `app_open` once per browser session (the id lives in sessionStorage, so a new tab is a new session). */
export function trackAppOpen(lang: string): void {
  if (!hasWindow()) return;
  const key = `katha.app_open.${sessionId()}`;
  try {
    if (window.sessionStorage.getItem(key)) return;
    window.sessionStorage.setItem(key, "1");
  } catch {
    /* fall through: fire once per page load without storage */
  }
  track("app_open", { lang, referrer: document.referrer ? new URL(document.referrer).host : null, path: window.location.pathname });
}
