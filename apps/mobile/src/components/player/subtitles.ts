import type { VideoPlayer } from "expo-video";
import { useEffect, useState } from "react";
import { getItem, setItem } from "@/lib/storage";
import type { SubtitleTrackOut } from "@/lib/types";

export type Cue = { start: number; end: number; text: string };

/**
 * expo-video (SDK 57) only exposes subtitle tracks embedded in the stream; `PlayOut.subtitles` are sideloaded
 * WebVTT files. We parse those ourselves and draw the current cue over the video.
 */
export function parseVtt(vtt: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = vtt.replace(/\r\n?/g, "\n").split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.length > 0);
    const timingIndex = lines.findIndex((l) => l.includes("-->"));
    if (timingIndex < 0) continue;
    const [startRaw, endRaw] = lines[timingIndex].split("-->").map((s) => s.trim().split(/\s+/)[0]);
    const start = parseTimestamp(startRaw);
    const end = parseTimestamp(endRaw);
    if (start === null || end === null) continue;
    const text = lines
      .slice(timingIndex + 1)
      .join("\n")
      .replace(/<[^>]+>/g, "")
      .trim();
    if (text) cues.push({ start, end, text });
  }
  return cues.sort((a, b) => a.start - b.start);
}

function parseTimestamp(raw: string | undefined): number | null {
  if (!raw) return null;
  const parts = raw.split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  const seconds = Number.parseFloat(parts[parts.length - 1].replace(",", "."));
  const minutes = Number.parseInt(parts[parts.length - 2], 10);
  const hours = parts.length === 3 ? Number.parseInt(parts[0], 10) : 0;
  if ([seconds, minutes, hours].some((n) => Number.isNaN(n))) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Incremental cue lookup: starting from the last index, move forward (or restart after a seek backwards).
 * Returns the index of the cue covering `time`, or -1.
 */
export function findCueIndex(cues: Cue[], time: number, fromIndex: number): number {
  let i = fromIndex >= 0 && fromIndex < cues.length && cues[fromIndex].start <= time ? fromIndex : 0;
  while (i < cues.length && cues[i].end < time) i++;
  if (i < cues.length && cues[i].start <= time && time <= cues[i].end) return i;
  return -1;
}

const OFF = "off";

/** Persisted subtitle language ("off" or a language code); null until loaded. */
export function useSubtitlePreference(appLang: string) {
  const [pref, setPref] = useState<string | null>(null);
  useEffect(() => {
    getItem("subtitles").then((v) => setPref(v ?? appLang));
  }, [appLang]);
  const choose = (lang: string | null) => {
    const v = lang ?? OFF;
    setPref(v);
    void setItem("subtitles", v);
  };
  return { pref, choose };
}

/** Pick the active track for a grant: the preferred language if present, otherwise none. */
export function selectTrack(tracks: SubtitleTrackOut[], pref: string | null): SubtitleTrackOut | null {
  if (!pref || pref === OFF) return null;
  return tracks.find((t) => t.lang === pref) ?? tracks.find((t) => t.lang.split("-")[0] === pref.split("-")[0]) ?? null;
}

/** Cycle: off -> track 1 -> track 2 -> ... -> off. */
export function nextTrackLang(tracks: SubtitleTrackOut[], current: SubtitleTrackOut | null): string | null {
  if (tracks.length === 0) return null;
  if (!current) return tracks[0].lang;
  const i = tracks.findIndex((t) => t.lang === current.lang);
  return i < 0 || i === tracks.length - 1 ? null : tracks[i + 1].lang;
}

/** Select the stream's embedded subtitle track for `lang` (or none). Native objects are mutated outside React. */
export function applyEmbeddedTrack(player: VideoPlayer, lang: string | null): void {
  try {
    const base = lang?.split("-")[0];
    const embedded = base ? player.availableSubtitleTracks.find((t) => t.language.split("-")[0] === base) : undefined;
    player.subtitleTrack = embedded ?? null;
  } catch {
    // The player may not have loaded a source yet.
  }
}

// Parsed VTT files keyed by URL. Signed URLs rotate with grants, so the cache stays small; cap it anyway.
const cueCache = new Map<string, Cue[]>();
const CACHE_LIMIT = 24;

async function loadCues(url: string, signal: AbortSignal): Promise<Cue[]> {
  const cached = cueCache.get(url);
  if (cached) return cached;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`subtitles ${res.status}`);
  const cues = parseVtt(await res.text());
  if (cueCache.size >= CACHE_LIMIT) {
    const oldest = cueCache.keys().next().value;
    if (oldest !== undefined) cueCache.delete(oldest);
  }
  cueCache.set(url, cues);
  return cues;
}

/** Cues for a sideloaded track (null while loading / when no track). Fetches are aborted when the track changes. */
export function useSubtitleCues(track: SubtitleTrackOut | null): Cue[] | null {
  const [state, setState] = useState<{ url: string; cues: Cue[] } | null>(null);

  useEffect(() => {
    if (!track) return;
    const controller = new AbortController();
    loadCues(track.url, controller.signal)
      .then((cues) => {
        if (!controller.signal.aborted) setState({ url: track.url, cues });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ url: track.url, cues: [] });
      });
    return () => controller.abort();
  }, [track]);

  return track && state?.url === track.url ? state.cues : null;
}
