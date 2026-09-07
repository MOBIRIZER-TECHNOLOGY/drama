"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { track } from "@/lib/analytics";
import { useApp, useHref, useT } from "@/lib/app-context";
import { useAuth } from "@/lib/auth-context";
import { clientApi } from "@/lib/client-api";
import { call } from "@/lib/errors";
import { formatNumber } from "@/lib/format";
import { useToast } from "@/lib/toast";
import { useLoader } from "@/lib/use-loader";
import type { PlayOut, SeriesCard } from "@/lib/types";
import { AgeGateDialog } from "../AgeGateDialog";
import { PlaybackBeacons } from "../player/beacons";
import { useHls } from "../player/use-hls";
import { Button, buttonClass } from "../ui/Button";
import { IconHeart, IconLock, IconMute, IconPlay, IconShare, IconStar, IconVolume, Spinner } from "../ui/icons";

type ItemState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; grant: PlayOut }
  | { kind: "auth" }
  | { kind: "locked" }
  | { kind: "age_gate" }
  | { kind: "error"; message: string };

/**
 * Vertical, scroll-snapped feed of portrait players — one per series, playing its first episode.
 * Only the centred item holds a video element; everything else is a poster, so the feed never
 * keeps more than one HLS session alive.
 */
export function ShortsFeed({ items }: { items: SeriesCard[] }) {
  const t = useT();
  const [activeId, setActiveId] = useState<string | null>(items[0]?.id ?? null);
  const [muted, setMuted] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        // The most visible item wins; ties keep the current one (no flapping mid-scroll).
        let best: { id: string; ratio: number } | null = null;
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.seriesId;
          if (!id || !entry.isIntersecting) continue;
          if (!best || entry.intersectionRatio > best.ratio) best = { id, ratio: entry.intersectionRatio };
        }
        if (best && best.ratio >= 0.55) setActiveId(best.id);
      },
      { root, threshold: [0.25, 0.55, 0.8] },
    );
    root.querySelectorAll("[data-series-id]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [items]);

  if (items.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="no-scrollbar h-[calc(100svh-3.5rem)] snap-y snap-mandatory overflow-y-auto overscroll-y-contain sm:h-[calc(100svh-4rem)]"
      aria-label={t("shorts.title", "Shorts")}
    >
      {items.map((series, index) => (
        <ShortItem
          key={series.id}
          series={series}
          active={activeId === series.id}
          priority={index === 0}
          muted={muted}
          onToggleMuted={() => setMuted((m) => !m)}
        />
      ))}
    </div>
  );
}

function ShortItem({
  series,
  active,
  priority,
  muted,
  onToggleMuted,
}: {
  series: SeriesCard;
  active: boolean;
  priority: boolean;
  muted: boolean;
  onToggleMuted: () => void;
}) {
  const t = useT();
  const href = useHref();
  const toast = useToast();
  const { lang } = useApp();
  const { status, user, openAuth, refreshUser } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<ItemState>({ kind: "idle" });
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);
  const [likeCount, setLikeCount] = useState(series.like_count);
  const [ageGateBusy, setAgeGateBusy] = useState(false);
  const [ageGateOpen, setAgeGateOpen] = useState(false);
  const [ageGateError, setAgeGateError] = useState<string | null>(null);
  const episodeId = series.first_episode_id ?? null;

  const beacons = useMemo(
    () => (episodeId ? new PlaybackBeacons({ episodeId, seriesId: series.id, surface: "shorts" }) : undefined),
    [episodeId, series.id],
  );

  /** Ask for a playback grant. State is only written after the request resolves, so activation never cascades renders. */
  const loadGrant = useCallback(async () => {
    if (!episodeId) return;
    const { data, error } = await call(() =>
      clientApi.POST("/v1/episodes/{episode_id}/play", { params: { path: { episode_id: episodeId } } }),
    );
    if (data) return setState({ kind: "ready", grant: data });
    if (error.code === "age_gate_required") {
      setState({ kind: "age_gate" });
      if (status !== "authenticated") openAuth();
      return;
    }
    if (error.status === 401) return setState({ kind: "auth" });
    if (error.status === 403) return setState({ kind: "locked" });
    setState({ kind: "error", message: error.message });
  }, [episodeId, status, openAuth]);

  // The centred item asks for a (fresh, short-lived) grant; a scrolled-away item just pauses and unmounts its video.
  const loadWhenActive = useCallback(async () => {
    if (!active) return;
    await loadGrant();
  }, [active, loadGrant]);
  useLoader(loadWhenActive);

  useEffect(() => {
    if (!active) videoRef.current?.pause();
  }, [active]);

  const grant = state.kind === "ready" ? state.grant : null;
  const loading = active && (state.kind === "idle" || state.kind === "loading");
  const { error: playerError } = useHls(videoRef, {
    src: active ? (grant?.hls_url ?? null) : null,
    startAt: 0,
    autoPlay: true,
    expiresAt: grant?.expires_at,
    labels: {
      unsupported: t("player.unsupported", "This browser cannot play HLS video."),
      networkError: t("player.network_error", "Playback stopped. Tap to reload."),
    },
    onReload: () => void loadGrant(),
    onLevelSwitch: (kbps, height) => beacons?.levelSwitch(kbps, height),
    onFatalError: (code) => beacons?.error(code, true),
    onSourceAttached: () => beacons?.start(),
  });

  const toggle = async (kind: "like" | "favorite") => {
    if (status !== "authenticated") return openAuth();
    const path = kind === "like" ? "/v1/series/{series_id}/like" : "/v1/series/{series_id}/favorite";
    const { data, error } = await call(() => clientApi.POST(path, { params: { path: { series_id: series.id } } }));
    if (error) return toast(error.message, "error");
    if (kind === "like") {
      setLiked(data.active);
      setLikeCount((c) => (typeof data.count === "number" ? data.count : c + (data.active ? 1 : -1)));
    } else {
      setSaved(data.active);
      toast(data.active ? t("series.added_to_list", "Added to My List") : t("series.removed_from_list", "Removed from My List"), "success");
    }
  };

  const share = async () => {
    const url = `${window.location.origin}${href(`/series/${series.slug}`)}`;
    track("share", { series_id: series.id, episode_id: episodeId, surface: "shorts", method: typeof navigator.share === "function" ? "native" : "clipboard" });
    try {
      if (navigator.share) {
        await navigator.share({ title: series.title, text: series.synopsis ?? undefined, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast(t("series.link_copied", "Link copied"), "success");
    } catch {
      /* user cancelled */
    }
  };

  const confirmAge = async () => {
    setAgeGateBusy(true);
    setAgeGateError(null);
    if (!user?.age_confirmed_at) {
      const { error } = await call(() => clientApi.PATCH("/v1/auth/me", { body: { age_confirmed: true } }));
      if (error) {
        setAgeGateBusy(false);
        setAgeGateError(error.message);
        return;
      }
      await refreshUser();
    }
    setAgeGateBusy(false);
    setAgeGateOpen(false);
    void loadGrant();
  };

  const watchFull = href(`/series/${series.slug}?ep=1`);
  const poster = series.cover_url;

  return (
    <section
      data-series-id={series.id}
      aria-label={series.title}
      className="flex h-full snap-start snap-always items-center justify-center px-2 py-2"
    >
      <div className="relative h-full w-auto max-w-full" style={{ aspectRatio: "9 / 16" }}>
        <div className="relative h-full w-full overflow-hidden rounded-lg border border-line bg-black">
          {poster && (
            <Image
              src={poster}
              alt=""
              fill
              sizes="(min-width: 640px) 46vh, 100vw"
              priority={priority}
              className={`object-cover transition-opacity ${grant?.hls_url && active ? "opacity-0" : "opacity-60"}`}
            />
          )}
          {active && grant?.hls_url && (
            <video
              ref={videoRef}
              playsInline
              muted={muted}
              loop
              preload="metadata"
              poster={poster ?? undefined}
              className="absolute inset-0 h-full w-full object-cover"
              onClick={() => {
                const v = videoRef.current;
                if (!v) return;
                if (v.paused) void v.play().catch(() => undefined);
                else v.pause();
              }}
              onPlaying={() => beacons?.playing()}
              onWaiting={() => beacons?.waiting()}
              onEnded={() => beacons?.complete()}
              onError={() => beacons?.error(`media_${videoRef.current?.error?.code ?? 0}`, true)}
            />
          )}

          {/* Overlay states */}
          {(loading || (state.kind === "ready" && !grant?.hls_url)) && active && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Spinner size={32} className="text-ink" />
            </div>
          )}
          {active && (state.kind === "auth" || state.kind === "locked" || state.kind === "age_gate" || state.kind === "error" || playerError) && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 px-6 text-center">
              {state.kind === "auth" ? (
                <>
                  <IconLock size={28} className="text-gold" />
                  <p className="text-sm text-ink2">{t("shorts.sign_in", "Sign in to watch this one.")}</p>
                  <Button size="sm" onClick={openAuth}>
                    {t("auth.sign_in", "Sign in")}
                  </Button>
                </>
              ) : state.kind === "age_gate" ? (
                <>
                  <p className="text-sm text-ink2">{t("age_gate.player", "This drama is rated for adults.")}</p>
                  <Button size="sm" onClick={() => setAgeGateOpen(true)}>
                    {t("age_gate.confirm", "I am 18 or older")}
                  </Button>
                </>
              ) : state.kind === "locked" ? (
                <>
                  <IconLock size={28} className="text-gold" />
                  <p className="text-sm text-ink2">{t("player.locked", "This episode is locked.")}</p>
                  <Link href={watchFull} className={buttonClass("gold", "sm")}>
                    {t("shorts.watch_full", "Watch full")}
                  </Link>
                </>
              ) : (
                <>
                  <p className="text-sm text-ink2">{state.kind === "error" ? state.message : playerError}</p>
                  <Button variant="secondary" size="sm" onClick={() => void loadGrant()}>
                    {t("common.retry", "Try again")}
                  </Button>
                </>
              )}
            </div>
          )}
          {!active && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="rounded-pill bg-black/50 p-3 text-ink">
                <IconPlay size={22} />
              </span>
            </div>
          )}

          {/* Title + watch full */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-4 pt-12">
            <div className="pointer-events-auto flex flex-col items-start gap-2 pe-14">
              <Link href={href(`/series/${series.slug}`)} className="font-display line-clamp-2 text-lg font-semibold text-ink hover:underline">
                {series.title}
              </Link>
              {series.synopsis && <p className="line-clamp-2 text-xs text-ink2">{series.synopsis}</p>}
              <Link href={watchFull} className={buttonClass("primary", "sm")}>
                <IconPlay size={14} />
                {t("shorts.watch_full", "Watch full")}
              </Link>
            </div>
          </div>

          {/* Action rail */}
          <div className="absolute end-2 bottom-24 flex flex-col items-center gap-4">
            <RailButton
              label={muted ? t("player.unmute", "Unmute") : t("player.mute", "Mute")}
              onClick={onToggleMuted}
              pressed={!muted}
            >
              {muted ? <IconMute size={22} /> : <IconVolume size={22} />}
            </RailButton>
            <RailButton
              label={liked ? t("series.liked", "Liked") : t("series.like", "Like")}
              onClick={() => void toggle("like")}
              pressed={liked}
              caption={formatNumber(likeCount, lang)}
            >
              <IconHeart size={22} filled={liked} className={liked ? "text-accent" : ""} />
            </RailButton>
            <RailButton
              label={saved ? t("series.in_list", "In My List") : t("series.add_to_list", "My List")}
              onClick={() => void toggle("favorite")}
              pressed={saved}
            >
              <IconStar size={22} filled={saved} className={saved ? "text-gold" : ""} />
            </RailButton>
            <RailButton label={t("series.share", "Share")} onClick={() => void share()}>
              <IconShare size={22} />
            </RailButton>
          </div>
        </div>
      </div>

      <AgeGateDialog
        open={ageGateOpen}
        busy={ageGateBusy}
        error={ageGateError}
        onConfirm={() => void confirmAge()}
        onClose={() => setAgeGateOpen(false)}
      />
    </section>
  );
}

function RailButton({
  label,
  onClick,
  pressed,
  caption,
  children,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  caption?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className="flex flex-col items-center gap-0.5 rounded-pill p-2 text-ink hover:bg-ink/15 focus-visible:outline-2 focus-visible:outline-accent"
    >
      {children}
      {caption && <span className="text-[11px] tabular-nums text-ink2">{caption}</span>}
    </button>
  );
}
