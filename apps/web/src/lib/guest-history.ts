"use client";

/**
 * Where a signed-out viewer left off, kept in this browser.
 *
 * Progress is only ever written to the server for a signed-in account, so a guest who watched four free
 * episodes and came back the next day landed on a home page with no memory of them at all — and the app asked
 * them to find the series again by name. This is the local half of Continue Watching: the same promise, made
 * before there is an account to hang it on, and it doubles as the reason to make one.
 *
 * Deliberately local and unsynced. Nothing here is sent anywhere; signing in supersedes it with server history.
 */

const KEY = "katha.guest_history";
const MAX = 12;
/** A minute in is a watch; three seconds is a misclick and should not take a slot. */
const MIN_POSITION_SEC = 15;

export type GuestWatch = {
  seriesId: string;
  slug: string;
  title: string;
  coverUrl: string | null;
  episodeNumber: number;
  positionSec: number;
  updatedAt: number;
};

const listeners = new Set<() => void>();
/** `useSyncExternalStore` compares snapshots by identity, so the parsed list is cached until it changes. */
let cache: { raw: string; parsed: GuestWatch[] } | null = null;

function readRaw(): string {
  try {
    return window.localStorage.getItem(KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

function parse(raw: string): GuestWatch[] {
  try {
    const rows: unknown = JSON.parse(raw);
    if (!Array.isArray(rows)) return [];
    return rows.filter(
      (r): r is GuestWatch =>
        !!r &&
        typeof r === "object" &&
        typeof (r as GuestWatch).seriesId === "string" &&
        typeof (r as GuestWatch).slug === "string" &&
        typeof (r as GuestWatch).episodeNumber === "number",
    );
  } catch {
    return [];
  }
}

export function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // Another tab writing the same key must update this one too.
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function getSnapshot(): GuestWatch[] {
  const raw = readRaw();
  if (!cache || cache.raw !== raw) cache = { raw, parsed: parse(raw) };
  return cache.parsed;
}

/** Server-rendered HTML has no browser storage; one shared empty array keeps hydration stable. */
const EMPTY: GuestWatch[] = [];
export function getServerSnapshot(): GuestWatch[] {
  return EMPTY;
}

function write(rows: GuestWatch[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(rows.slice(0, MAX)));
  } catch {
    // Private mode or a full quota: the rail simply stays empty.
  }
  for (const l of listeners) l();
}

/** Upserts one series, newest first. A later episode of the same series replaces the earlier entry. */
export function record(entry: Omit<GuestWatch, "updatedAt">): void {
  if (entry.positionSec < MIN_POSITION_SEC) return;
  const rows = getSnapshot().filter((r) => r.seriesId !== entry.seriesId);
  write([{ ...entry, positionSec: Math.floor(entry.positionSec), updatedAt: Date.now() }, ...rows]);
}

export function remove(seriesId: string): void {
  write(getSnapshot().filter((r) => r.seriesId !== seriesId));
}

export function clear(): void {
  write([]);
}
