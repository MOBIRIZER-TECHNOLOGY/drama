"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { formatDuration } from "@/lib/format";
import type { SubtitleTrack } from "@/lib/types";
import type { PlaybackBeacons } from "./beacons";
import { useHls } from "./use-hls";
import {
  IconCaptions,
  IconCheck,
  IconExitFullscreen,
  IconFullscreen,
  IconMute,
  IconNext,
  IconPause,
  IconPlay,
  IconVolume,
  Spinner,
} from "../ui/icons";
import { Button } from "../ui/Button";

export type PlayerLabels = {
  play: string;
  pause: string;
  mute: string;
  unmute: string;
  fullscreen: string;
  exitFullscreen: string;
  next: string;
  seek: string;
  volume: string;
  retry: string;
  unsupported: string;
  networkError: string;
  speed: string;
  subtitles: string;
  subtitlesOff: string;
};

export type VideoPlayerProps = {
  src: string | null;
  embedHtml: string | null;
  poster?: string | null;
  title: string;
  resumeAt: number;
  /** ISO time the signed URL stops working; a fatal network error after this asks the parent for a new grant once. */
  expiresAt?: string;
  autoPlay: boolean;
  hasNext: boolean;
  labels: PlayerLabels;
  /** WebVTT tracks from the playback grant. */
  subtitles?: SubtitleTrack[];
  /** Language used when the viewer has no saved subtitle preference (the UI language). */
  defaultSubtitleLang?: string;
  /** Human-readable name for a subtitle language code. */
  subtitleLabel?: (lang: string) => string;
  /** QoE beacons for this playback attempt (play_start, first_frame, rebuffer, bitrate_switch, ...). */
  beacons?: PlaybackBeacons;
  onNext: () => void;
  onEnded: () => void;
  /** Called every ~15s while playing, on pause and on unmount. */
  onProgress: (positionSec: number, durationSec: number | null) => void;
  /** Ask the parent for a fresh playback grant (signed URLs expire). */
  onReload: () => void;
};

const PROGRESS_INTERVAL_MS = 15_000;
const HIDE_CONTROLS_MS = 2500;
const HOLD_MS = 350;
const SUBTITLE_PREF_KEY = "katha.subtitles";
const OFF = "off";

function readSubtitlePref(): string | null {
  try {
    return window.localStorage.getItem(SUBTITLE_PREF_KEY);
  } catch {
    return null;
  }
}

function writeSubtitlePref(value: string): void {
  try {
    window.localStorage.setItem(SUBTITLE_PREF_KEY, value);
  } catch {
    /* storage unavailable */
  }
}

/** Saved preference wins (including "off"); otherwise the UI language if a track exists; otherwise off. */
function initialSubtitle(tracks: SubtitleTrack[], defaultLang: string | undefined): string {
  if (tracks.length === 0) return OFF;
  const saved = readSubtitlePref();
  if (saved === OFF) return OFF;
  if (saved && tracks.some((t) => t.lang === saved)) return saved;
  if (defaultLang && tracks.some((t) => t.lang === defaultLang)) return defaultLang;
  return OFF;
}

export function VideoPlayer(props: VideoPlayerProps) {
  const {
    src,
    embedHtml,
    poster,
    title,
    resumeAt,
    expiresAt,
    autoPlay,
    hasNext,
    labels,
    subtitles = [],
    defaultSubtitleLang,
    subtitleLabel = (l) => l.toUpperCase(),
    beacons,
    onNext,
    onEnded,
    onProgress,
    onReload,
  } = props;
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hold = useRef<{ timer: ReturnType<typeof setTimeout> | null; held: boolean; pointerId: number | null }>({
    timer: null,
    held: false,
    pointerId: null,
  });
  const lastPos = useRef(0);
  const lastDur = useRef<number | null>(null);
  const callbacks = useRef({ onProgress, onEnded, onReload });
  useEffect(() => {
    callbacks.current = { onProgress, onEnded, onReload };
  }, [onProgress, onEnded, onReload]);

  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [controls, setControls] = useState(true);
  const [fast, setFast] = useState(false);
  const [subtitle, setSubtitle] = useState<string>(() => initialSubtitle(subtitles, defaultSubtitleLang));
  const [ccOpen, setCcOpen] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);

  const reportProgress = useCallback(() => {
    callbacks.current.onProgress(lastPos.current, lastDur.current);
  }, []);

  // Media source setup (native HLS on Safari, hls.js elsewhere).
  const { error, setError } = useHls(videoRef, {
    src,
    startAt: resumeAt,
    autoPlay,
    expiresAt,
    labels: { unsupported: labels.unsupported, networkError: labels.networkError },
    onReload: () => callbacks.current.onReload(),
    onLevelSwitch: (kbps, height) => beacons?.levelSwitch(kbps, height),
    onFatalError: (code) => beacons?.error(code, true),
    onSourceAttached: () => {
      setTime(0);
      setBuffered(0);
      lastPos.current = resumeAt;
      beacons?.start();
    },
  });

  // Apply the subtitle selection to the browser's text tracks (the <track> elements are rendered below).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const apply = () => {
      const tracks = video.textTracks;
      for (let i = 0; i < tracks.length; i++) {
        const tr = tracks[i];
        if (tr.kind !== "subtitles" && tr.kind !== "captions") continue;
        tr.mode = subtitle !== OFF && tr.language === subtitle ? "showing" : "disabled";
      }
    };
    apply();
    video.textTracks.addEventListener("addtrack", apply);
    return () => video.textTracks.removeEventListener("addtrack", apply);
  }, [subtitle, subtitles]);

  // Periodic progress + flush on unmount, on pagehide and when the tab is hidden.
  useEffect(() => {
    if (!src) return;
    const id = setInterval(() => {
      const v = videoRef.current;
      if (v && !v.paused && !v.ended) reportProgress();
    }, PROGRESS_INTERVAL_MS);
    const onHide = () => {
      if (document.visibilityState === "hidden") reportProgress();
    };
    window.addEventListener("pagehide", reportProgress);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      clearInterval(id);
      window.removeEventListener("pagehide", reportProgress);
      document.removeEventListener("visibilitychange", onHide);
      reportProgress();
    };
  }, [src, reportProgress]);

  // Fullscreen state.
  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Close the CC menu on outside click / Escape.
  useEffect(() => {
    if (!ccOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.("[data-cc-menu]")) setCcOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setCcOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [ccOpen]);

  const showControls = useCallback(() => {
    setControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      const v = videoRef.current;
      if (v && !v.paused) setControls(false);
    }, HIDE_CONTROLS_MS);
  }, []);
  // Keyboard users keep the controls while focus is inside them; otherwise hidden controls are inert.
  const controlsVisible = controls || focusWithin || ccOpen;

  useEffect(() => () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (hold.current.timer) clearTimeout(hold.current.timer);
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => undefined);
    else v.pause();
    showControls();
  }, [showControls]);

  const seekTo = useCallback(
    (to: number) => {
      const v = videoRef.current;
      if (!v) return;
      v.currentTime = to;
      beacons?.seek(to);
      showControls();
    },
    [beacons, showControls],
  );

  const seekBy = (delta: number) => {
    const v = videoRef.current;
    if (!v) return;
    seekTo(Math.min(Math.max(0, v.currentTime + delta), v.duration || v.currentTime + delta));
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
    showControls();
  };

  const toggleFullscreen = async () => {
    const el = containerRef.current;
    const v = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (!el) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (el.requestFullscreen) await el.requestFullscreen();
      else v?.webkitEnterFullscreen?.();
    } catch {
      /* fullscreen not permitted */
    }
  };

  const chooseSubtitle = (value: string) => {
    setSubtitle(value);
    writeSubtitlePref(value);
    setCcOpen(false);
    showControls();
  };

  // Hold on the right side for 2x; a short tap toggles play.
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const rightSide = e.clientX - rect.left > rect.width * 0.6;
    hold.current.held = false;
    hold.current.pointerId = e.pointerId;
    if (hold.current.timer) clearTimeout(hold.current.timer);
    if (!rightSide) return;
    hold.current.timer = setTimeout(() => {
      const v = videoRef.current;
      if (!v || v.paused) return;
      hold.current.held = true;
      v.playbackRate = 2;
      setFast(true);
    }, HOLD_MS);
  };
  const endHold = (e: ReactPointerEvent<HTMLDivElement>, isClick: boolean) => {
    if (hold.current.pointerId !== e.pointerId) return;
    if (hold.current.timer) clearTimeout(hold.current.timer);
    hold.current.timer = null;
    hold.current.pointerId = null;
    if (hold.current.held) {
      const v = videoRef.current;
      if (v) v.playbackRate = 1;
      setFast(false);
      hold.current.held = false;
      return;
    }
    if (isClick) togglePlay();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    switch (e.key) {
      case " ":
      case "k":
        e.preventDefault();
        togglePlay();
        break;
      case "ArrowRight":
        seekBy(5);
        break;
      case "ArrowLeft":
        seekBy(-5);
        break;
      case "m":
        toggleMute();
        break;
      case "f":
        void toggleFullscreen();
        break;
      case "c":
        if (subtitles.length) chooseSubtitle(subtitle === OFF ? (defaultSubtitleLang && subtitles.some((t) => t.lang === defaultSubtitleLang) ? defaultSubtitleLang : subtitles[0].lang) : OFF);
        break;
      case "n":
        if (hasNext) onNext();
        break;
    }
  };

  const onTimeUpdate = () => {
    const v = videoRef.current;
    if (!v) return;
    lastPos.current = v.currentTime;
    lastDur.current = Number.isFinite(v.duration) ? v.duration : null;
    setTime(v.currentTime);
    const ranges = v.buffered;
    for (let i = 0; i < ranges.length; i++) {
      if (ranges.start(i) <= v.currentTime && v.currentTime <= ranges.end(i)) {
        setBuffered(ranges.end(i));
        break;
      }
    }
  };

  if (embedHtml) {
    return (
      <div className="relative h-full w-full overflow-hidden rounded-lg border border-line bg-black">
        <iframe
          title={title}
          srcDoc={`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:#000;overflow:hidden}iframe,video{position:absolute;inset:0;width:100%;height:100%;border:0}</style></head><body>${embedHtml}</body></html>`}
          sandbox="allow-scripts allow-presentation allow-popups allow-forms"
          allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
          allowFullScreen
          className="absolute inset-0 h-full w-full"
        />
      </div>
    );
  }

  const pct = duration ? (time / duration) * 100 : 0;
  const bufPct = duration ? (buffered / duration) * 100 : 0;
  // Subtitle files usually live on the CDN; cross-origin <track> loads need CORS mode on the media element.
  const needsCors = subtitles.some((t) => {
    try {
      return new URL(t.url, window.location.href).origin !== window.location.origin;
    } catch {
      return false;
    }
  });

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      role="region"
      aria-label={title}
      onKeyDown={onKeyDown}
      onMouseMove={showControls}
      onMouseLeave={() => playing && !ccOpen && setControls(false)}
      className={`group/player relative h-full w-full select-none overflow-hidden rounded-lg border border-line bg-black outline-none focus-visible:ring-2 focus-visible:ring-accent ${fullscreen ? "rounded-none border-0" : ""}`}
    >
      <video
        ref={videoRef}
        poster={poster ?? undefined}
        playsInline
        preload="metadata"
        crossOrigin={needsCors ? "anonymous" : undefined}
        className="h-full w-full object-contain"
        onPlay={() => {
          setPlaying(true);
          showControls();
        }}
        onPause={() => {
          setPlaying(false);
          setControls(true);
          // `ended` fires its own report with completed=true; skip the duplicate pause report.
          if (!videoRef.current?.ended) reportProgress();
        }}
        onEnded={() => {
          setPlaying(false);
          setControls(true);
          beacons?.complete();
          callbacks.current.onEnded();
        }}
        onWaiting={() => {
          setWaiting(true);
          beacons?.waiting();
        }}
        onPlaying={() => {
          setWaiting(false);
          beacons?.playing();
        }}
        onCanPlay={() => setWaiting(false)}
        onTimeUpdate={onTimeUpdate}
        onDurationChange={() => setDuration(videoRef.current?.duration || 0)}
        onVolumeChange={() => {
          const v = videoRef.current;
          if (v) {
            setVolume(v.volume);
            setMuted(v.muted);
          }
        }}
        onError={() => {
          beacons?.error(`media_${videoRef.current?.error?.code ?? 0}`, true);
          setError(labels.networkError);
        }}
      >
        {subtitles.map((t) => (
          <track
            key={t.lang}
            kind="subtitles"
            src={t.url}
            srcLang={t.lang}
            label={subtitleLabel(t.lang)}
            default={subtitle === t.lang}
          />
        ))}
      </video>

      {/* Tap / hold surface */}
      <div
        className="absolute inset-0"
        onPointerDown={onPointerDown}
        onPointerUp={(e) => endHold(e, true)}
        onPointerCancel={(e) => endHold(e, false)}
        onPointerLeave={(e) => endHold(e, false)}
        onTouchStart={showControls}
      />

      {fast && (
        <div className="pointer-events-none absolute end-3 top-3 rounded-pill bg-black/60 px-2 py-1 text-xs font-semibold text-ink">
          2× {labels.speed}
        </div>
      )}

      {(waiting || (!playing && !error && src && time === 0 && autoPlay && !controlsVisible)) && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Spinner size={36} className="text-ink" />
        </div>
      )}

      {!playing && !error && !waiting && (
        <button
          type="button"
          onClick={togglePlay}
          aria-label={labels.play}
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-pill bg-accent/90 p-5 text-accent-ink hover:bg-accent"
        >
          <IconPlay size={30} />
        </button>
      )}

      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 px-6 text-center">
          <p className="text-sm text-ink2">{error}</p>
          <Button variant="secondary" size="sm" onClick={onReload}>
            {labels.retry}
          </Button>
        </div>
      )}

      {/* Controls */}
      <div
        inert={!controlsVisible}
        onFocus={() => setFocusWithin(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusWithin(false);
        }}
        className={`absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-gradient-to-t from-black/85 to-transparent px-3 pb-2 pt-10 transition-opacity ${controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"}`}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="relative h-5">
          <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-pill bg-ink/20">
            <div className="absolute inset-y-0 start-0 bg-ink/35" style={{ width: `${bufPct}%` }} />
            <div className="absolute inset-y-0 start-0 bg-accent" style={{ width: `${pct}%` }} />
          </div>
          <input
            type="range"
            className="k-range absolute inset-0"
            min={0}
            max={duration || 0}
            step={0.1}
            value={Math.min(time, duration || 0)}
            aria-label={labels.seek}
            aria-valuetext={`${formatDuration(time)} / ${formatDuration(duration)}`}
            onChange={(e) => seekTo(Number(e.target.value))}
          />
        </div>
        <div className="flex items-center gap-1">
          <ControlButton label={playing ? labels.pause : labels.play} onClick={togglePlay}>
            {playing ? <IconPause size={20} /> : <IconPlay size={20} />}
          </ControlButton>
          {hasNext && (
            <ControlButton label={labels.next} onClick={onNext}>
              <IconNext size={20} />
            </ControlButton>
          )}
          <ControlButton label={muted || volume === 0 ? labels.unmute : labels.mute} onClick={toggleMute}>
            {muted || volume === 0 ? <IconMute size={20} /> : <IconVolume size={20} />}
          </ControlButton>
          <input
            type="range"
            className="k-range hidden w-16 shrink-0 lg:block"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            aria-label={labels.volume}
            style={{ background: `linear-gradient(to right, var(--k-ink) ${(muted ? 0 : volume) * 100}%, rgba(255,255,255,.25) 0)`, height: 4, borderRadius: 999 }}
            onChange={(e) => {
              const v = videoRef.current;
              if (!v) return;
              v.volume = Number(e.target.value);
              v.muted = v.volume === 0;
            }}
          />
          <span className="ms-1.5 whitespace-nowrap text-xs tabular-nums text-ink2" dir="ltr">
            {formatDuration(time)} / {formatDuration(duration)}
          </span>
          <span className="flex-1" />
          {subtitles.length > 0 && (
            <div className="relative" data-cc-menu>
              <ControlButton
                label={labels.subtitles}
                onClick={() => setCcOpen((v) => !v)}
                pressed={subtitle !== OFF}
                expanded={ccOpen}
              >
                <IconCaptions size={20} className={subtitle !== OFF ? "text-accent" : ""} />
              </ControlButton>
              {ccOpen && (
                <ul
                  role="menu"
                  aria-label={labels.subtitles}
                  className="absolute bottom-full end-0 mb-2 min-w-40 overflow-hidden rounded-md border border-line bg-surface py-1 text-sm"
                >
                  <SubtitleOption active={subtitle === OFF} onSelect={() => chooseSubtitle(OFF)}>
                    {labels.subtitlesOff}
                  </SubtitleOption>
                  {subtitles.map((t) => (
                    <SubtitleOption key={t.lang} active={subtitle === t.lang} onSelect={() => chooseSubtitle(t.lang)}>
                      {subtitleLabel(t.lang)}
                    </SubtitleOption>
                  ))}
                </ul>
              )}
            </div>
          )}
          <ControlButton label={fullscreen ? labels.exitFullscreen : labels.fullscreen} onClick={() => void toggleFullscreen()}>
            {fullscreen ? <IconExitFullscreen size={20} /> : <IconFullscreen size={20} />}
          </ControlButton>
        </div>
      </div>
    </div>
  );
}

function SubtitleOption({ active, onSelect, children }: { active: boolean; onSelect: () => void; children: React.ReactNode }) {
  return (
    <li role="none">
      <button
        type="button"
        role="menuitemradio"
        aria-checked={active}
        onClick={onSelect}
        className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-start hover:bg-surface2 ${active ? "text-ink" : "text-ink2"}`}
      >
        {children}
        {active && <IconCheck size={14} className="text-accent" />}
      </button>
    </li>
  );
}

function ControlButton({
  label,
  onClick,
  children,
  pressed,
  expanded,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  pressed?: boolean;
  expanded?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      aria-expanded={expanded}
      aria-haspopup={expanded === undefined ? undefined : "menu"}
      title={label}
      className="rounded-pill p-1.5 text-ink hover:bg-ink/15 focus-visible:outline-2 focus-visible:outline-accent"
    >
      {children}
    </button>
  );
}
