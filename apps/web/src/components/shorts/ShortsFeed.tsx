"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { track } from "@/lib/analytics";
import { useHref, useT } from "@/lib/app-context";
import { useAuth } from "@/lib/auth-context";
import { clientApi } from "@/lib/client-api";
import { call } from "@/lib/errors";
import { useToast } from "@/lib/toast";
import { useLoader } from "@/lib/use-loader";
import type { PlayOut, ShortItem as ShortItemData } from "@/lib/types";
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

/** Load the next page once the viewer is within this many items of the end. */
const PREFETCH_WITHIN = 4;

/**
 * The vertical feed: a chain of episodes, not a carousel of first episodes.
 *
 * `/v1/shorts` returns each series' free run followed by its first locked episode, so scrolling continues the
 * story the viewer was hooked by and arrives at the paywall inside the feed. Previously every item was episode
 * one of a different series, the list stopped after twelve, and the paywall was never reached at all.
 *
 * Only the centred item holds a video element; everything else is a poster, so the feed never keeps more than
 * one HLS session alive.
 */
export function ShortsFeed({ initial, nextCursor, lang }: { initial: ShortItemData[]; nextCursor: string | null; lang: string }) {
  const t = useT();
  const [extra, setExtra] = useState<ShortItemData[]>([]);
  const [cursor, setCursor] = useState<string | null>(nextCursor);
  const [activeId, setActiveId] = useState<string | null>(initial[0]?.episode_id ?? null);
  const [muted, setMuted] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const loadingMore = useRef(false);

  const items = useMemo(() => [...initial, ...extra], [initial, extra]);

  const loadMore = useCallback(async () => {
    if (loadingMore.current || !cursor) return;
    loadingMore.current = true;
    const { data } = await call(() => clientApi.GET("/v1/shorts", { params: { query: { lang, cursor } } }));
    if (data) {
      setExtra((prev) => {
        const seen = new Set([...initial, ...prev].map((i) => i.episode_id));
        return [...prev, ...data.items.filter((i) => !seen.has(i.episode_id))];
      });
      setCursor(data.next_cursor ?? null);
    }
    loadingMore.current = false;
  }, [cursor, lang, initial]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        // The most visible item wins; ties keep the current one (no flapping mid-scroll).
        let best: { id: string; ratio: number } | null = null;
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.episodeId;
          if (!id || !entry.isIntersecting) continue;
          if (!best || entry.intersectionRatio > best.ratio) best = { id, ratio: entry.intersectionRatio };
        }
        if (!best || best.ratio < 0.55) return;
        const id = best.id;
        setActiveId(id);
        const index = items.findIndex((i) => i.episode_id === id);
        if (index >= 0) {
          const item = items[index];
          track("shorts_swipe", { position: index, series_id: item.series_id, episode_number: item.episode_number });
          if (index >= items.length - PREFETCH_WITHIN) void loadMore();
        }
      },
      { root, threshold: [0.25, 0.55, 0.8] },
    );
    root.querySelectorAll("[data-episode-id]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [items, loadMore]);

  if (items.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="no-scrollbar h-[calc(100svh-3.5rem)] snap-y snap-mandatory overflow-y-auto overscroll-y-contain sm:h-[calc(100svh-4rem)]"
      aria-label={t("shorts.title", "Shorts")}
    >
      {items.map((item, index) => (
        <ShortItem
          key={item.episode_id}
          item={item}
          active={activeId === item.episode_id}
          priority={index === 0}
          showSwipeHint={index === 0}
          muted={muted}
          onToggleMuted={() => setMuted((m) => !m)}
        />
      ))}
    </div>
  );
}

function ShortItem({
  item,
  active,
  priority,
  showSwipeHint,
  muted,
  onToggleMuted,
}: {
  item: ShortItemData;
  active: boolean;
  priority: boolean;
  showSwipeHint: boolean;
  muted: boolean;
  onToggleMuted: () => void;
}) {
  const t = useT();
  const href = useHref();
  const toast = useToast();
  const { status, user, openAuth, refreshUser } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<ItemState>({ kind: "idle" });
  // Seeded from the server. Both used to start `false` regardless of the truth, so a series the viewer had
  // already saved rendered unsaved and one tap silently removed it.
  const [liked, setLiked] = useState(item.is_liked);
  const [saved, setSaved] = useState(item.is_favorite);
  const [ageGateBusy, setAgeGateBusy] = useState(false);
  const [ageGateOpen, setAgeGateOpen] = useState(false);
  const [ageGateError, setAgeGateError] = useState<string | null>(null);
  const episodeId = item.episode_id;
  const seriesId = item.series_id;

  const beacons = useMemo(() => new PlaybackBeacons({ episodeId, seriesId, surface: "shorts" }), [episodeId, seriesId]);

  /** Ask for a playback grant. State is only written after the request resolves, so activation never cascades renders. */
  const loadGrant = useCallback(async () => {
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
    const { data, error } = await call(() => clientApi.POST(path, { params: { path: { series_id: seriesId } } }));
    if (error) return toast(error.message, "error");
    if (kind === "like") {
      setLiked(data.active);
    } else {
      setSaved(data.active);
      toast(data.active ? t("series.added_to_list", "Added to My List") : t("series.removed_from_list", "Removed from My List"), "success");
    }
  };

  const share = async () => {
    // Carry the episode and a campaign tag, so the recipient lands on the cliffhanger that prompted the share
    // rather than on episode one, and the funnel can tell organic shares apart.
    const params = new URLSearchParams({ utm_source: "share" });
    if (item.episode_number > 1) params.set("ep", String(item.episode_number));
    if (user?.referral_code) params.set("ref", user.referral_code);
    const url = `${window.location.origin}${href(`/series/${item.slug}`)}?${params}`;
    track("share", { series_id: seriesId, episode_id: episodeId, surface: "shorts", method: typeof navigator.share === "function" ? "native" : "clipboard" });
    try {
      if (navigator.share) {
        await navigator.share({ title: item.title, text: item.synopsis ?? undefined, url });
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

  const watchFull = href(`/series/${item.slug}?ep=${item.episode_number}`);
  const poster = item.thumbnail_url ?? item.cover_url;
  const genre = item.categories[0]?.name;

  return (
    <section
      data-episode-id={item.episode_id}
      aria-label={`${item.title} - ${t("unlock.position", "Episode {n} of {total}", { n: item.episode_number, total: item.episode_count })}`}
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
                  <p className="font-display text-lg font-semibold text-ink">
                    {t("unlock.title", "Unlock episode {n}", { n: item.episode_number })}
                  </p>
                  <p className="text-sm text-ink2">{t("shorts.locked_price", "{n} coins, unlocked forever", { n: item.price })}</p>
                  <Link href={watchFull} className={buttonClass("gold", "md")}>
                    {t("shorts.unlock_cta", "Unlock and keep watching")}
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
              <div className="flex flex-wrap items-center gap-2">
                {genre && <span className="rounded-pill bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-ink">{genre}</span>}
                <span className="text-[11px] text-ink2">
                  {t("unlock.position", "Episode {n} of {total}", { n: item.episode_number, total: item.episode_count })}
                </span>
              </div>
              <Link href={href(`/series/${item.slug}`)} className="font-display line-clamp-2 text-lg font-semibold text-ink hover:underline">
                {item.title}
              </Link>
              {item.synopsis && <p className="line-clamp-2 text-xs text-ink2">{item.synopsis}</p>}
              <Link href={watchFull} className={buttonClass("primary", "sm")}>
                <IconPlay size={14} />
                {t("shorts.watch_full", "Watch full")}
              </Link>
              {showSwipeHint && <p className="text-[11px] text-muted">{t("shorts.swipe_hint", "Swipe up for the next episode")}</p>}
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
