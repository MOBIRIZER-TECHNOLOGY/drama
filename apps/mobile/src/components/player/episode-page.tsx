import { colors, radii, spacing } from "@katha/tokens";
import { useEventListener } from "expo";
import { Image } from "expo-image";
import { VideoView, type VideoPlayer, type VideoPlayerStatus, type VideoTrack } from "expo-video";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, StyleSheet, View } from "react-native";
import { WebView, type WebViewNavigation } from "react-native-webview";
import { Icon } from "@/components/icons";
import { safePlayerCall, setTimeUpdateInterval } from "@/components/player/player-pool";
import { SeekBar } from "@/components/player/seek-bar";
import { applyEmbeddedTrack, findCueIndex, useSubtitleCues, type Cue } from "@/components/player/subtitles";
import { Button, Text } from "@/components/ui";
import { track } from "@/lib/analytics";
import type { Grant } from "@/lib/play";
import { putProgress } from "@/lib/play";
import type { SubtitleTrackOut } from "@/lib/types";

export const SPEEDS = [1, 1.5, 2] as const;
export type Speed = (typeof SPEEDS)[number];

const PROGRESS_INTERVAL_MS = 15_000;

export type LoadError = { code: "locked" | "unauthorized" | "not_ready" | "age_gate" | "error"; message: string };

export type EpisodePageProps = {
  episodeId: string;
  /** Sent with the QoE beacons so playback can be attributed to a title. */
  seriesId?: string;
  /** Which surface the page belongs to; separates full-player QoE from the shorts feed. */
  surface?: "player" | "shorts";
  /** Whether this page is the one the pager is showing. */
  active: boolean;
  /** Player for this page, or null when the page is outside the prev/current/next window. */
  player: VideoPlayer | null;
  grant: Grant | null;
  /** Non-null when the grant request failed; the page shows the message (and a sign-in button for 401). */
  loadError: LoadError | null;
  posterUrl: string | null;
  /** Controls chrome: hidden in immersive mode. */
  immersive: boolean;
  onToggleImmersive: () => void;
  speed: Speed;
  onCycleSpeed: () => void;
  onEnded: () => void;
  onRetry: () => void;
  onSignIn?: () => void;
  /** Active sideloaded subtitle track (from the grant) and the CC toggle. */
  subtitleTrack?: SubtitleTrackOut | null;
  subtitleCount?: number;
  onCycleSubtitles?: () => void;
  /** Extra chrome drawn over the video (top bar, side rail). Rendered only when not immersive. */
  overlay?: React.ReactNode;
  /** Whether to write watch progress (false for the shorts feed and guests). */
  trackProgress?: boolean;
  /** Shorts pages start muted; the full player is never muted. */
  muted?: boolean;
  /** Safe-area bottom inset so the seek bar clears the home indicator. */
  bottomInset?: number;
  /** Show a replay affordance (the last episode ended and there is nothing to advance to). */
  showReplay?: boolean;
};

/** Progress accounting shared by the listeners and the flush paths; mutated outside render. */
type ProgressBox = { position: number; lastWriteAt: number; ended: boolean };

/**
 * Subscribes to the native player with `useEventListener` (auto-removed on change/unmount). Split out so the
 * parent can render it only when a player exists: hooks cannot be conditional.
 */
function PlayerListeners({
  player,
  onTime,
  onPlaying,
  onStatus,
  onEnd,
  onVideoTrack,
}: {
  player: VideoPlayer;
  onTime: (t: number) => void;
  onPlaying: (v: boolean) => void;
  onStatus: (s: VideoPlayerStatus, error: string | null) => void;
  onEnd: () => void;
  onVideoTrack: (track: VideoTrack | null) => void;
}) {
  useEventListener(player, "timeUpdate", ({ currentTime }) => onTime(currentTime));
  useEventListener(player, "playingChange", ({ isPlaying }) => onPlaying(isPlaying));
  useEventListener(player, "statusChange", ({ status, error }) => onStatus(status, error?.message ?? null));
  useEventListener(player, "playToEnd", onEnd);
  // HLS renditions: the native player reports the track it switched to (bitrate/size when the manifest has them).
  useEventListener(player, "videoTrackChange", ({ videoTrack }) => onVideoTrack(videoTrack ?? null));
  return null;
}

/** QoE bookkeeping for one page, mutated outside render (timings must not trigger re-renders). */
type QoeBox = {
  /** `play()` timestamp for the current attempt; 0 when no attempt is pending a first frame. */
  startedAt: number;
  firstFrameSent: boolean;
  /** Timestamp of the `loading` status that interrupted playback, or 0 when not rebuffering. */
  stalledAt: number;
  wasPlaying: boolean;
  lastTrackId: string | null;
  errorSent: boolean;
  completeSent: boolean;
};

export const EpisodePage = memo(function EpisodePage({
  episodeId,
  seriesId,
  surface = "player",
  active,
  player,
  grant,
  loadError,
  posterUrl,
  immersive,
  onToggleImmersive,
  speed,
  onCycleSpeed,
  onEnded,
  onRetry,
  onSignIn,
  subtitleTrack = null,
  subtitleCount = 0,
  onCycleSubtitles,
  overlay,
  trackProgress = true,
  muted = false,
  bottomInset = 0,
  showReplay = false,
}: EpisodePageProps) {
  // `position` is whole seconds (drives the seek bar); precise time stays in a ref for cues.
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState<VideoPlayerStatus>("idle");
  const [flash, setFlash] = useState<"play" | "pause" | null>(null);
  const [holding, setHolding] = useState(false);
  const [cue, setCue] = useState<string | null>(null);
  const progress = useRef<ProgressBox>({ position: 0, lastWriteAt: 0, ended: false });
  const qoe = useRef<QoeBox>({ startedAt: 0, firstFrameSent: false, stalledAt: 0, wasPlaying: false, lastTrackId: null, errorSent: false, completeSent: false });
  const cueState = useRef<{ cues: Cue[] | null; index: number }>({ cues: null, index: -1 });
  const holdRef = useRef(false);
  const speedRef = useRef<number>(speed);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  const isEmbed = Boolean(grant && !grant.hls_url && grant.embed_html);
  const cues = useSubtitleCues(active ? subtitleTrack : null);
  useEffect(() => {
    cueState.current = { cues, index: -1 };
  }, [cues]);
  // A stale cue string from a previous track is hidden as soon as the track goes away.
  const shownCue = cues ? cue : null;

  const flushProgress = useCallback(
    (completed = false) => {
      if (!trackProgress) return;
      const p = progress.current;
      if (p.position <= 0 && !completed) return;
      p.lastWriteAt = Date.now();
      putProgress(episodeId, p.position, completed);
    },
    [episodeId, trackProgress],
  );

  const onTime = useCallback(
    (t: number) => {
      const p = progress.current;
      p.position = t;
      const whole = Math.floor(t);
      setPosition((prev) => (prev === whole ? prev : whole));
      if (player && player.duration > 0) setDuration((d) => (d === player.duration ? d : player.duration));
      if (active && trackProgress && Date.now() - p.lastWriteAt >= PROGRESS_INTERVAL_MS) flushProgress();
      const cs = cueState.current;
      if (cs.cues) {
        const idx = findCueIndex(cs.cues, t, cs.index);
        if (idx !== cs.index) {
          cs.index = idx;
          setCue(idx >= 0 ? cs.cues[idx].text : null);
        }
      }
    },
    [player, active, trackProgress, flushProgress],
  );
  /** Identity carried by every beacon from this page. */
  const beacon = useCallback(() => ({ episode_id: episodeId, series_id: seriesId ?? null, surface }), [episodeId, seriesId, surface]);

  const onPlaying = useCallback(
    (isPlaying: boolean) => {
      setPlaying(isPlaying);
      const q = qoe.current;
      if (isPlaying) {
        // The first `playing` after play() is the first rendered frame: that is the startup time users feel.
        if (!q.firstFrameSent && q.startedAt > 0) {
          q.firstFrameSent = true;
          track("first_frame", { ...beacon(), ttff_ms: Date.now() - q.startedAt });
        }
        if (q.stalledAt > 0) {
          track("rebuffer", { ...beacon(), duration_ms: Date.now() - q.stalledAt });
          q.stalledAt = 0;
        }
      }
      q.wasPlaying = isPlaying;
    },
    [beacon],
  );

  const onStatus = useCallback(
    (s: VideoPlayerStatus, error: string | null) => {
      setStatus(s);
      if (s === "readyToPlay" && player && player.duration > 0) setDuration(player.duration);
      const q = qoe.current;
      // A `loading` status while playback was under way is a stall; it ends when the player is ready again.
      if (s === "loading" && q.wasPlaying && q.stalledAt === 0) q.stalledAt = Date.now();
      else if (s === "readyToPlay" && q.stalledAt > 0) {
        track("rebuffer", { ...beacon(), duration_ms: Date.now() - q.stalledAt });
        q.stalledAt = 0;
      }
      if (s === "error" && !q.errorSent) {
        q.errorSent = true;
        track("play_error", { ...beacon(), code: "player_error", message: error });
      }
    },
    [player, beacon],
  );

  const onVideoTrack = useCallback(
    (videoTrack: VideoTrack | null) => {
      const q = qoe.current;
      if (!videoTrack) return;
      const previous = q.lastTrackId;
      q.lastTrackId = videoTrack.id;
      // The first track is the initial rendition, not a switch.
      if (previous === null || previous === videoTrack.id) return;
      track("bitrate_switch", {
        ...beacon(),
        bitrate: videoTrack.peakBitrate ?? videoTrack.averageBitrate ?? videoTrack.bitrate,
        height: videoTrack.size?.height ?? null,
        width: videoTrack.size?.width ?? null,
      });
    },
    [beacon],
  );

  const onEnd = useCallback(() => {
    const p = progress.current;
    p.ended = true;
    if (player) p.position = player.duration || p.position;
    const q = qoe.current;
    if (!q.completeSent) {
      q.completeSent = true;
      track("play_complete", { ...beacon(), duration_sec: Math.round(p.position) });
    }
    flushProgress(true);
    onEnded();
  }, [player, flushProgress, onEnded, beacon]);

  // A new episode on this page starts fresh QoE accounting.
  useEffect(() => {
    qoe.current = { startedAt: 0, firstFrameSent: false, stalledAt: 0, wasPlaying: false, lastTrackId: null, errorSent: false, completeSent: false };
  }, [episodeId]);

  // Grant failures (locked, expired, asset not ready) are playback errors too, and never reach the player.
  useEffect(() => {
    if (!active || !loadError) return;
    track("play_error", { ...beacon(), code: loadError.code, message: loadError.message });
  }, [active, loadError, beacon]);

  // Play/pause with page activation; write progress before pausing when leaving.
  useEffect(() => {
    if (!player || !grant?.hls_url) return;
    if (!active) {
      setTimeUpdateInterval(player, 0);
      safePlayerCall(player, (p) => p.pause());
      return undefined;
    }
    progress.current.ended = false;
    // Start of a playback attempt: `first_frame` measures from here to the first `playing` event.
    const q = qoe.current;
    q.startedAt = Date.now();
    q.firstFrameSent = false;
    q.errorSent = false;
    track("play_start", { ...beacon(), position_sec: Math.round(grant.resume_position_sec ?? 0) });
    safePlayerCall(player, (p) => {
      p.playbackRate = holdRef.current ? 2 : speedRef.current;
      p.play();
    });
    return () => {
      flushProgress();
      setTimeUpdateInterval(player, 0);
      safePlayerCall(player, (p) => p.pause());
    };
  }, [player, grant, active, flushProgress, beacon]);

  // Only the active player emits time updates; finer when cues are on.
  useEffect(() => {
    if (!player) return;
    setTimeUpdateInterval(player, active ? (cues ? 0.25 : 0.5) : 0);
  }, [player, active, cues]);

  // Flush progress when the app goes to the background.
  useEffect(() => {
    if (!active || !trackProgress) return;
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "background" || s === "inactive") flushProgress();
    });
    return () => sub.remove();
  }, [active, trackProgress, flushProgress]);

  useEffect(() => {
    if (player && active) safePlayerCall(player, (p) => (p.playbackRate = holding ? 2 : speed));
  }, [player, active, speed, holding]);

  useEffect(() => {
    if (player) safePlayerCall(player, (p) => (p.muted = muted));
  }, [player, muted]);

  useEffect(() => {
    if (player && active) applyEmbeddedTrack(player, subtitleTrack?.lang ?? null);
  }, [player, active, subtitleTrack]);

  const togglePlay = useCallback(() => {
    if (!player || !grant?.hls_url) return;
    safePlayerCall(player, (p) => {
      if (p.playing) {
        p.pause();
        setFlash("pause");
      } else {
        p.play();
        setFlash("play");
      }
    });
    setTimeout(() => setFlash(null), 500);
  }, [player, grant]);

  const onSeek = useCallback(
    (sec: number) => {
      if (!player) return;
      track("seek", { ...beacon(), from_sec: Math.round(progress.current.position), to_sec: Math.round(sec) });
      safePlayerCall(player, (p) => (p.currentTime = sec));
      progress.current.position = sec;
      progress.current.lastWriteAt = Date.now(); // a seek resets the write interval
      cueState.current.index = -1;
      setPosition(Math.floor(sec));
    },
    [player, beacon],
  );

  const replay = useCallback(() => {
    if (!player) return;
    safePlayerCall(player, (p) => {
      p.currentTime = 0;
      p.play();
    });
    progress.current.ended = false;
    cueState.current.index = -1;
    setPosition(0);
  }, [player]);

  const startHold = useCallback(() => {
    holdRef.current = true;
    setHolding(true);
  }, []);
  const endHold = useCallback(() => {
    if (!holdRef.current) return;
    holdRef.current = false;
    setHolding(false);
  }, []);

  const showChrome = !immersive;
  const embed = isEmbed && grant?.embed_html ? buildEmbed(grant.embed_html) : null;

  return (
    <View style={styles.page}>
      {player ? <PlayerListeners player={player} onTime={onTime} onPlaying={onPlaying} onStatus={onStatus} onEnd={onEnd} onVideoTrack={onVideoTrack} /> : null}
      {posterUrl ? <Image source={posterUrl} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={isEmbed ? 0 : 12} /> : null}

      {embed ? (
        <WebView
          source={{ html: embed.html, baseUrl: embed.baseUrl }}
          style={styles.web}
          originWhitelist={embed.origins}
          onShouldStartLoadWithRequest={(req: WebViewNavigation) => embed.allows(req.url)}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          allowsFullscreenVideo
          javaScriptEnabled
          javaScriptCanOpenWindowsAutomatically={false}
          allowFileAccess={false}
          allowFileAccessFromFileURLs={false}
          allowUniversalAccessFromFileURLs={false}
          setSupportMultipleWindows={false}
        />
      ) : player && grant?.hls_url ? (
        <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} fullscreenOptions={{ enable: false }} allowsPictureInPicture={false} />
      ) : null}

      {!isEmbed ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {/* Left 60%: tap toggles play. Right 40%: tap toggles play, hold plays at 2x. */}
          <View style={styles.tapZones}>
            <Pressable style={styles.tapLeft} onPress={togglePlay} accessibilityRole="button" accessibilityLabel={playing ? "Pause" : "Play"} />
            <Pressable
              style={styles.tapRight}
              onPress={togglePlay}
              onLongPress={startHold}
              delayLongPress={250}
              onPressOut={endHold}
              accessibilityRole="button"
              accessibilityLabel="Hold for 2x speed"
            />
          </View>

          {shownCue ? (
            <View style={[styles.cueBox, { bottom: (showChrome ? 96 : 40) + bottomInset }]} pointerEvents="none">
              <Text variant="body" color={colors.ink} style={styles.cueText}>
                {shownCue}
              </Text>
            </View>
          ) : null}

          {flash ? (
            <View style={styles.flash} pointerEvents="none">
              <Icon name={flash === "play" ? "play" : "pause"} size={34} />
            </View>
          ) : null}

          {holding ? (
            <View style={styles.holdBadge} pointerEvents="none">
              <Text variant="caption" color={colors.ink}>
                2x ▶▶
              </Text>
            </View>
          ) : null}

          {active && status === "loading" && !loadError ? (
            <View style={styles.centerMsg} pointerEvents="none">
              <Text variant="caption" color={colors.ink2}>
                Buffering…
              </Text>
            </View>
          ) : null}

          {loadError ? (
            <View style={styles.centerMsg}>
              <Text variant="body" color={colors.ink} style={{ textAlign: "center" }}>
                {loadError.message}
              </Text>
              {loadError.code === "unauthorized" && onSignIn ? (
                <Button title="Sign in" small onPress={onSignIn} />
              ) : loadError.code !== "locked" && loadError.code !== "age_gate" ? (
                <Button title="Try again" variant="secondary" small onPress={onRetry} />
              ) : null}
            </View>
          ) : status === "error" && active ? (
            <View style={styles.centerMsg}>
              <Text variant="body" color={colors.ink} style={{ textAlign: "center" }}>
                Playback failed. The link may have expired.
              </Text>
              <Button title="Try again" variant="secondary" small onPress={onRetry} />
            </View>
          ) : showReplay && active && !playing ? (
            <View style={styles.centerMsg}>
              <Text variant="body" color={colors.ink} style={{ textAlign: "center" }}>
                You have reached the end of this series.
              </Text>
              <Button title="Replay" small onPress={replay} left={<Icon name="play" size={12} color={colors.accentInk} />} />
            </View>
          ) : null}

          {showChrome ? (
            <>
              {overlay}
              <View style={[styles.bottom, { paddingBottom: spacing.sm + bottomInset }]} pointerEvents="box-none">
                <View style={styles.bottomRow}>
                  {subtitleCount > 0 && onCycleSubtitles ? (
                    <Pressable
                      onPress={onCycleSubtitles}
                      accessibilityRole="button"
                      accessibilityLabel={subtitleTrack ? `Subtitles ${subtitleTrack.lang}` : "Subtitles off"}
                      style={[styles.chip, subtitleTrack && styles.chipActive]}
                    >
                      <Text variant="caption" color={subtitleTrack ? colors.accentInk : colors.ink}>
                        CC{subtitleTrack ? ` ${subtitleTrack.lang.toUpperCase()}` : ""}
                      </Text>
                    </Pressable>
                  ) : null}
                  <Pressable onPress={onCycleSpeed} accessibilityRole="button" accessibilityLabel={`Speed ${speed}x`} style={styles.chip}>
                    <Text variant="caption" color={colors.ink}>
                      {speed}x
                    </Text>
                  </Pressable>
                  <Pressable onPress={onToggleImmersive} accessibilityRole="button" accessibilityLabel="Hide controls" style={styles.chip}>
                    <Icon name="expand" size={16} />
                  </Pressable>
                </View>
                <SeekBar position={position} duration={duration} onSeek={onSeek} />
              </View>
            </>
          ) : (
            <Pressable
              onPress={onToggleImmersive}
              style={[styles.collapse, { bottom: spacing.xl + bottomInset }]}
              accessibilityRole="button"
              accessibilityLabel="Show controls"
              hitSlop={10}
            >
              <Icon name="collapse" size={16} />
            </Pressable>
          )}
        </View>
      ) : showChrome ? (
        overlay
      ) : null}
    </View>
  );
});

/**
 * Wrap provider embed HTML for the WebView. Only https origins referenced by the embed (iframe/script/video src)
 * may load; everything else is blocked, and the page's own baseUrl is the first such origin.
 */
function buildEmbed(html: string): { html: string; baseUrl: string; origins: string[]; allows: (url: string) => boolean } {
  const origins = new Set<string>();
  for (const m of html.matchAll(/\bsrc\s*=\s*["']?(https:\/\/[^"'\s>]+)/gi)) {
    try {
      origins.add(new URL(m[1]).origin);
    } catch {
      // ignore malformed src
    }
  }
  const list = Array.from(origins);
  const baseUrl = list[0] ?? "https://katha.app";
  const allows = (url: string) => url === "about:blank" || url.startsWith("about:srcdoc") || list.some((o) => url.startsWith(`${o}/`) || url === o);
  const page = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;background:#000;height:100%;overflow:hidden}iframe,video{width:100%;height:100%;border:0}</style></head><body>${html}</body></html>`;
  return { html: page, baseUrl, origins: list.length ? list : ["https://katha.app"], allows };
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#000" },
  web: { flex: 1, backgroundColor: "#000" },
  tapZones: { ...StyleSheet.absoluteFill, flexDirection: "row" } as const,
  tapLeft: { flex: 6 },
  tapRight: { flex: 4 },
  cueBox: { position: "absolute", left: spacing.xl, right: spacing.xl, alignItems: "center" },
  cueText: {
    textAlign: "center",
    backgroundColor: "rgba(0,0,0,0.65)",
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.sm,
    fontSize: 16,
    lineHeight: 22,
    overflow: "hidden",
  },
  flash: {
    position: "absolute",
    top: "45%",
    alignSelf: "center",
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  holdBadge: {
    position: "absolute",
    top: 96,
    alignSelf: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  centerMsg: {
    position: "absolute",
    left: spacing.xl,
    right: spacing.xl,
    top: "40%",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  bottom: { position: "absolute", left: 0, right: 0, bottom: 0, gap: spacing.xs },
  bottomRow: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm, paddingHorizontal: spacing.lg },
  chip: {
    minWidth: 40,
    height: 30,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  chipActive: { backgroundColor: colors.accent },
  collapse: {
    position: "absolute",
    right: spacing.lg,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
});
