"use client";

import type Hls from "hls.js";
import { useEffect, useRef, useState, type RefObject } from "react";

export type UseHlsOptions = {
  /** Signed HLS URL from `/play`, or null while there is nothing to load. */
  src: string | null;
  /** Position to start from (seconds); values <= 1 start from the beginning. */
  startAt?: number;
  autoPlay: boolean;
  /** ISO time the signed URL stops working; a fatal network error after this asks for a new grant once. */
  expiresAt?: string;
  labels: { unsupported: string; networkError: string };
  /** Ask the parent for a fresh playback grant (signed URLs expire). */
  onReload?: () => void;
  /** hls.js switched rendition (kbps, height). Not called on native HLS. */
  onLevelSwitch?: (kbps: number, height?: number) => void;
  /** Fatal playback error (hls.js `details` or the media element's error code). */
  onFatalError?: (code: string) => void;
  /** Source attached and loading started. */
  onSourceAttached?: () => void;
};

/**
 * Attach an HLS source to a `<video>`: native HLS on Safari, hls.js elsewhere (dynamic import). Re-runs when `src`
 * changes; every other option is read through a ref so the stream is not reloaded on re-renders.
 */
export function useHls(videoRef: RefObject<HTMLVideoElement | null>, options: UseHlsOptions) {
  const { src } = options;
  const opts = useRef(options);
  useEffect(() => {
    opts.current = options;
  });
  const hlsRef = useRef<Hls | null>(null);
  const autoReloaded = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    let cancelled = false;
    setError(null);
    const { startAt = 0, autoPlay } = opts.current;
    const start = startAt > 1 ? startAt : 0;
    const tryPlay = () => {
      if (!opts.current.autoPlay) return;
      video.play().catch(() => undefined);
    };
    opts.current.onSourceAttached?.();

    // Native HLS only on Safari (or when MSE is missing); Chrome/Firefox go through hls.js. Chrome answers
    // "maybe" to canPlayType for HLS on some platforms but then never loads the stream.
    const ua = navigator.userAgent;
    const isSafari = /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Edg\/|OPR\/|Android/.test(ua);
    const canNative = video.canPlayType("application/vnd.apple.mpegurl") !== "";
    const native = canNative && (isSafari || typeof MediaSource === "undefined");
    if (native) {
      video.src = src;
      const onMeta = () => {
        if (start) video.currentTime = start;
        tryPlay();
      };
      video.addEventListener("loadedmetadata", onMeta, { once: true });
      return () => {
        cancelled = true;
        video.removeEventListener("loadedmetadata", onMeta);
        video.removeAttribute("src");
        video.load();
      };
    }

    import("hls.js").then(({ default: HlsCtor }) => {
      if (cancelled) return;
      if (!HlsCtor.isSupported()) {
        setError(opts.current.labels.unsupported);
        return;
      }
      const hls = new HlsCtor({ startPosition: start || -1, enableWorker: true, lowLatencyMode: false, autoStartLoad: true });
      hlsRef.current = hls;
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(HlsCtor.Events.MANIFEST_PARSED, () => {
        if (autoPlay) tryPlay();
      });
      hls.on(HlsCtor.Events.LEVEL_SWITCHED, (_evt, data) => {
        const level = hls.levels[data.level];
        if (level) opts.current.onLevelSwitch?.(level.bitrate / 1000, level.height || undefined);
      });
      hls.on(HlsCtor.Events.ERROR, (_evt, data) => {
        if (!data.fatal) return;
        opts.current.onFatalError?.(data.details);
        if (data.type === HlsCtor.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
          return;
        }
        hls.destroy();
        hlsRef.current = null;
        // An expired signed URL looks like a network error: fetch a fresh grant once before showing the retry UI.
        const expiresAt = opts.current.expiresAt;
        const expired = expiresAt ? Date.parse(expiresAt) <= Date.now() : false;
        if (expired && !autoReloaded.current && opts.current.onReload) {
          autoReloaded.current = true;
          opts.current.onReload();
          return;
        }
        setError(opts.current.labels.networkError);
      });
    });

    return () => {
      cancelled = true;
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [src, videoRef]);

  return { error, setError, hlsRef };
}
