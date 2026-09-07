"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { track } from "@/lib/analytics";
import { useApp, useT } from "@/lib/app-context";
import { useAuth } from "@/lib/auth-context";
import { clientApi } from "@/lib/client-api";
import { call } from "@/lib/errors";
import { formatNumber } from "@/lib/format";
import { useToast } from "@/lib/toast";
import type { EpisodeOut, PlayOut, SeriesDetail } from "@/lib/types";
import { AgeGateDialog } from "../AgeGateDialog";
import { PlaybackBeacons } from "../player/beacons";
import { VideoPlayer, type PlayerLabels } from "../player/VideoPlayer";
import { Button } from "../ui/Button";
import { IconClock, IconCoin, IconFlag, IconHeart, IconLock, IconPlay, IconShare, IconStar, Spinner } from "../ui/icons";
import { EpisodeGrid } from "./EpisodeGrid";
import { highestAccessibleNumber, lockState } from "./lock-state";
import { ReportDialog } from "./ReportDialog";
import { UnlockDialog, type BundleQuote, type UnlockStatus } from "./UnlockDialog";

/**
 * Result of POST /play for one episode, keyed by `${authStatus}:${episodeId}` so a sign-in/out naturally refetches.
 * Absence means "not requested yet" (= loading).
 */
type Grant =
  | { kind: "ready"; grant: PlayOut }
  | { kind: "locked" }
  | { kind: "auth" }
  | { kind: "age_gate" }
  | { kind: "not_ready" }
  | { kind: "error"; message: string };

type PlayState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; grant: PlayOut }
  | { kind: "locked" }
  | { kind: "auth" }
  | { kind: "age_gate" }
  | { kind: "not_ready" }
  | { kind: "error"; message: string };

/** What to retry once the viewer confirms their age. */
type AgeGate = { open: boolean; retry: "play" | "unlock" | null; busy: boolean; error: string | null };

export function SeriesView({ series, initialEpisode }: { series: SeriesDetail; initialEpisode: number | null }) {
  const t = useT();
  const toast = useToast();
  const { lang, languages } = useApp();
  const { status, user, balance, openAuth, setBalance, refreshUser } = useAuth();

  const [episodes, setEpisodes] = useState<EpisodeOut[]>(series.episodes);
  const sorted = useMemo(() => [...episodes].sort((a, b) => a.number - b.number), [episodes]);
  const highest = highestAccessibleNumber(episodes);

  // ?ep=N, else where the viewer left off, else episode 1.
  const [currentId, setCurrentId] = useState<string | null>(() => {
    const wanted = initialEpisode ?? series.continue_episode_number ?? 1;
    const list = [...series.episodes].sort((a, b) => a.number - b.number);
    return (list.find((e) => e.number === wanted) ?? list[0])?.id ?? null;
  });
  const [grants, setGrants] = useState<Record<string, Grant>>({});
  const [unlockTarget, setUnlockTarget] = useState<EpisodeOut | null>(null);
  const [unlockStatus, setUnlockStatus] = useState<UnlockStatus>({ kind: "idle" });
  const [bundle, setBundle] = useState<BundleQuote | null>(null);
  const [liked, setLiked] = useState(series.is_liked);
  const [likeCount, setLikeCount] = useState(series.like_count);
  const [favorite, setFavorite] = useState(series.is_favorite);
  const [reportOpen, setReportOpen] = useState(false);
  const [synopsisOpen, setSynopsisOpen] = useState(false);
  const synopsisRef = useRef<HTMLParagraphElement>(null);
  const [synopsisClamped, setSynopsisClamped] = useState(false);
  const [continueNumber, setContinueNumber] = useState(series.continue_episode_number);
  const [ageGate, setAgeGate] = useState<AgeGate>({ open: false, retry: null, busy: false, error: null });
  const inFlight = useRef(new Set<string>());
  const viewed = useRef(false);
  const hydratedFor = useRef<string | null>(null);

  const current = useMemo(() => episodes.find((e) => e.id === currentId) ?? null, [episodes, currentId]);
  // One beacon collector per episode; the player calls it from the media events.
  const beacons = useMemo(
    () => (currentId ? new PlaybackBeacons({ episodeId: currentId, seriesId: series.id, surface: "series" }) : undefined),
    [currentId, series.id],
  );
  const nextEpisode = useMemo(() => (current ? (sorted.find((e) => e.number === current.number + 1) ?? null) : null), [sorted, current]);
  const grantKey = current && status !== "loading" ? `${status}:${current.id}` : null;

  // Guests can play free episodes; anything else needs a session before we even ask.
  const needsSession = status === "anonymous" && !!current && !current.is_free;

  // Derived player state: no effect needed to "retry after sign-in" — the keyed grant map simply refills.
  const play: PlayState = !current || !grantKey
    ? { kind: "idle" }
    : needsSession
      ? { kind: "auth" }
      : (grants[grantKey] ?? { kind: "loading" });

  const dropGrant = useCallback((id: string) => {
    setGrants((g) => {
      const keys = Object.keys(g).filter((k) => k.endsWith(`:${id}`));
      if (keys.length === 0) return g;
      const next = { ...g };
      for (const k of keys) delete next[k];
      return next;
    });
  }, []);

  // Request a playback grant for the current episode whenever one is missing.
  useEffect(() => {
    if (!current || !grantKey || needsSession || grants[grantKey] || inFlight.current.has(grantKey)) return;
    const ep = current;
    const key = grantKey;
    inFlight.current.add(key);
    // Results are keyed by grantKey, so a late response is still the right answer for that key: never discard it.
    (async () => {
      const { data, error } = await call(() =>
        clientApi.POST("/v1/episodes/{episode_id}/play", { params: { path: { episode_id: ep.id } } }),
      );
      inFlight.current.delete(key);
      const put = (grant: Grant) => setGrants((g) => ({ ...g, [key]: grant }));
      if (data) {
        put({ kind: "ready", grant: data });
      } else if (error.code === "age_gate_required") {
        // Adult-rated: guests are asked to sign in first, members confirm their age.
        put({ kind: "age_gate" });
        if (status === "authenticated") setAgeGate({ open: true, retry: "play", busy: false, error: null });
        else openAuth();
      } else if (error.status === 403) {
        put({ kind: "locked" });
        setUnlockStatus({ kind: "idle" });
        setUnlockTarget(ep);
      } else if (error.status === 401) {
        put({ kind: "auth" });
      } else if (error.code === "asset_not_ready") {
        put({ kind: "not_ready" });
      } else {
        put({ kind: "error", message: error.message });
      }
    })();
  }, [current, grantKey, needsSession, grants, status, openAuth]);

  // The page is server-rendered anonymously; once signed in, refetch so lock states, likes and resume point are the user's.
  useEffect(() => {
    if (status !== "authenticated" || !user || hydratedFor.current === user.id) return;
    hydratedFor.current = user.id;
    (async () => {
      const { data } = await call(() =>
        clientApi.GET("/v1/series/{id_or_slug}", { params: { path: { id_or_slug: series.id }, query: { lang } } }),
      );
      if (!data) return;
      setEpisodes(data.episodes);
      setLiked(data.is_liked);
      setLikeCount(data.like_count);
      setFavorite(data.is_favorite);
      setContinueNumber(data.continue_episode_number);
    })();
  }, [status, user, series.id, lang]);

  useEffect(() => {
    if (viewed.current) return;
    viewed.current = true;
    track("series_view", { series_id: series.id, slug: series.slug, is_premium: series.is_premium, episodes: series.episode_count });
    void call(() => clientApi.POST("/v1/series/{series_id}/view", { params: { path: { series_id: series.id } } }));
  }, [series.id, series.slug, series.is_premium, series.episode_count]);

  // `paywall_view` once per episode the unlock dialog opens for.
  const paywallSeen = useRef<string | null>(null);
  useEffect(() => {
    if (!unlockTarget) {
      paywallSeen.current = null;
      return;
    }
    if (paywallSeen.current === unlockTarget.id) return;
    paywallSeen.current = unlockTarget.id;
    track("paywall_view", {
      series_id: series.id,
      episode_id: unlockTarget.id,
      episode_number: unlockTarget.number,
      price: unlockTarget.price,
      balance,
    });
  }, [unlockTarget, series.id, balance]);

  // Whether the clamped synopsis is actually overflowing. Read from layout rather than guessed, and re-read on
  // resize because the same text clamps at one width and not another.
  useEffect(() => {
    const el = synopsisRef.current;
    if (!el) return;
    const measure = () => setSynopsisClamped(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [series.synopsis]);

  /**
   * Reflect the current episode in the URL.
   *
   * An explicit choice pushes, so Back steps to the previous episode; an automatic advance replaces, so
   * finishing six episodes does not bury the page under six history entries. Everything used to replace, which
   * meant Back left the series altogether after watching anything.
   */
  const syncUrl = (n: number, { push = false }: { push?: boolean } = {}) => {
    const url = new URL(window.location.href);
    url.searchParams.set("ep", String(n));
    const method = push ? window.history.pushState : window.history.replaceState;
    method.call(window.history, window.history.state, "", url.toString());
  };

  /** Select an episode: always requests a fresh grant (signed URLs expire). */
  const select = (ep: EpisodeOut, { explicit = true }: { explicit?: boolean } = {}) => {
    setCurrentId(ep.id);
    syncUrl(ep.number, { push: explicit });
    if (status === "anonymous" && !ep.is_free) {
      if (explicit) openAuth();
      return;
    }
    if (lockState(ep, highest) === "later") {
      setGrants((g) => ({ ...g, [`${status}:${ep.id}`]: { kind: "locked" } }));
      setUnlockStatus({ kind: "sequential", message: t("series.unlock_previous_first", "Unlock previous episodes first") });
      setUnlockTarget(ep);
      return;
    }
    dropGrant(ep.id);
  };

  const markUnlocked = (id: string) =>
    setEpisodes((list) => list.map((e) => (e.id === id ? { ...e, unlocked: true, accessible: true } : e)));

  const markManyUnlocked = (ids: string[]) => {
    const set = new Set(ids);
    setEpisodes((list) => list.map((e) => (set.has(e.id) ? { ...e, unlocked: true, accessible: true } : e)));
  };

  // Price "unlock everything left" as soon as the paywall opens, so the bundle is a visible choice rather than
  // something the viewer would have to know to ask for. Stored against the auth status it was fetched under, so
  // signing out invalidates it by comparison instead of by an effect that resets state.
  const [bundleFor, setBundleFor] = useState<string | null>(null);
  useEffect(() => {
    if (!unlockTarget || status !== "authenticated") return;
    let live = true;
    void (async () => {
      const { data } = await call(() =>
        clientApi.GET("/v1/series/{series_id}/bundle", { params: { path: { series_id: series.id } } }),
      );
      if (!live || !data) return;
      setBundle(data);
      setBundleFor(status);
    })();
    return () => {
      live = false;
    };
  }, [unlockTarget, status, series.id]);
  const visibleBundle = unlockTarget && status === "authenticated" && bundleFor === status ? bundle : null;

  const unlockBundle = useCallback(async () => {
    if (status !== "authenticated") return openAuth();
    setUnlockStatus({ kind: "bundle-busy" });
    const { data, error } = await call(() =>
      clientApi.POST("/v1/series/{series_id}/bundle", { params: { path: { series_id: series.id } } }),
    );
    if (data) {
      setBalance(data.coin_balance);
      markManyUnlocked(data.episode_ids);
      const target = unlockTarget;
      setUnlockTarget(null);
      setUnlockStatus({ kind: "idle" });
      track("unlock_bundle", { series_id: series.id, episodes: data.episode_ids.length, spent: data.spent });
      toast(t("unlock.bundle_success", "{n} episodes unlocked", { n: data.episode_ids.length }), "gold");
      if (target) {
        setCurrentId(target.id);
        syncUrl(target.number);
        dropGrant(target.id);
      }
      return;
    }
    if (error.status === 402 || error.code === "insufficient_coins") {
      setUnlockStatus({ kind: "insufficient", message: error.message });
    } else if (error.code === "age_gate_required") {
      setUnlockStatus({ kind: "idle" });
      setAgeGate({ open: true, retry: "unlock", busy: false, error: null });
    } else {
      setUnlockStatus({ kind: "error", message: error.message });
    }
  }, [status, series.id, unlockTarget, openAuth, t, toast, setBalance, dropGrant]);

  const unlock = useCallback(async (method: "coins" | "ad") => {
    const ep = unlockTarget;
    if (!ep) return;
    if (status !== "authenticated") return openAuth();
    setUnlockStatus({ kind: "busy" });
    const { data, error } = await call(() =>
      clientApi.POST("/v1/episodes/{episode_id}/unlock", { params: { path: { episode_id: ep.id } }, body: { method } }),
    );
    if (data) {
      setBalance(data.coin_balance);
      markUnlocked(ep.id);
      setUnlockTarget(null);
      setUnlockStatus({ kind: "idle" });
      track("unlock", { series_id: series.id, episode_id: ep.id, episode_number: ep.number, method, price: ep.price });
      toast(t("unlock.success", "Episode {n} unlocked", { n: ep.number }), "gold");
      setCurrentId(ep.id);
      syncUrl(ep.number);
      dropGrant(ep.id);
      return;
    }
    if (error.code === "age_gate_required") {
      setUnlockStatus({ kind: "idle" });
      setAgeGate({ open: true, retry: "unlock", busy: false, error: null });
    } else if (error.status === 402 || error.code === "insufficient_coins") {
      setUnlockStatus({ kind: "insufficient", message: error.message });
    } else if (error.code === "already_accessible") {
      markUnlocked(ep.id);
      setUnlockTarget(null);
      setUnlockStatus({ kind: "idle" });
      setCurrentId(ep.id);
      dropGrant(ep.id);
    } else if (error.code === "sequential_unlock_required") {
      setUnlockStatus({ kind: "sequential", message: error.message });
    } else if (error.status === 401) {
      setUnlockStatus({ kind: "idle" });
      openAuth();
    } else {
      setUnlockStatus({ kind: "error", message: error.message });
    }
  }, [unlockTarget, status, openAuth, setBalance, toast, t, dropGrant, series.id]);

  /**
   * Age gate: confirm once on the account (`PATCH /v1/auth/me`), then retry whatever was blocked.
   * An account that already has `age_confirmed_at` skips the write and only retries.
   */
  const confirmAge = async () => {
    const retry = ageGate.retry;
    setAgeGate((g) => ({ ...g, busy: true, error: null }));
    if (!user?.age_confirmed_at) {
      const { error } = await call(() => clientApi.PATCH("/v1/auth/me", { body: { age_confirmed: true } }));
      if (error) {
        setAgeGate((g) => ({ ...g, busy: false, error: error.message }));
        return;
      }
      await refreshUser();
    }
    setAgeGate({ open: false, retry: null, busy: false, error: null });
    if (retry === "unlock") void unlock("coins");
    else if (current) dropGrant(current.id);
  };

  const putProgress = useCallback(
    (episodeId: string, positionSec: number, completed: boolean) => {
      if (status !== "authenticated") return;
      void call(() =>
        clientApi.PUT("/v1/episodes/{episode_id}/progress", {
          params: { path: { episode_id: episodeId } },
          body: { position_sec: Math.max(0, Math.floor(positionSec)), completed },
          keepalive: true,
        }),
      );
    },
    [status],
  );

  const onEnded = () => {
    if (!current) return;
    putProgress(current.id, current.duration_sec ?? 0, true);
    const grant = play.kind === "ready" ? play.grant : null;
    const nextId = grant?.next_episode_id ?? nextEpisode?.id ?? null;
    const next = nextId ? episodes.find((e) => e.id === nextId) : null;
    if (!next) return;
    if (next.accessible || next.is_free) {
      select(next, { explicit: false });
    } else if (status === "anonymous") {
      setCurrentId(next.id);
      syncUrl(next.number);
      openAuth();
    } else {
      setUnlockStatus(
        lockState(next, highest) === "later"
          ? { kind: "sequential", message: t("series.unlock_previous_first", "Unlock previous episodes first") }
          : { kind: "idle" },
      );
      setUnlockTarget(next);
    }
  };

  const toggle = async (kind: "like" | "favorite") => {
    if (status !== "authenticated") return openAuth();
    const path = kind === "like" ? "/v1/series/{series_id}/like" : "/v1/series/{series_id}/favorite";

    // Flip locally first and revert on failure. Waiting for the round trip meant the heart stayed empty for a
    // second on 3G, which reads as a button that does not work — so people tap it again.
    const wasLiked = liked;
    const wasCount = likeCount;
    const wasFavorite = favorite;
    if (kind === "like") {
      setLiked(!wasLiked);
      setLikeCount((c) => Math.max(0, c + (wasLiked ? -1 : 1)));
    } else {
      setFavorite(!wasFavorite);
    }

    const { data, error } = await call(() => clientApi.POST(path, { params: { path: { series_id: series.id } } }));
    if (error) {
      if (kind === "like") {
        setLiked(wasLiked);
        setLikeCount(wasCount);
      } else {
        setFavorite(wasFavorite);
      }
      return toast(error.message, "error");
    }
    // Settle on the server's answer, which is authoritative if the two ever disagree.
    if (kind === "like") {
      setLiked(data.active);
      if (typeof data.count === "number") setLikeCount(data.count);
    } else {
      setFavorite(data.active);
      toast(data.active ? t("series.added_to_list", "Added to My List") : t("series.removed_from_list", "Removed from My List"), "success");
    }
  };

  const share = async () => {
    const url = window.location.href;
    track("share", { series_id: series.id, episode_id: currentId, surface: "series", method: typeof navigator.share === "function" ? "native" : "clipboard" });
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

  const playerLabels: PlayerLabels = {
    play: t("player.play", "Play"),
    pause: t("player.pause", "Pause"),
    mute: t("player.mute", "Mute"),
    unmute: t("player.unmute", "Unmute"),
    fullscreen: t("player.fullscreen", "Fullscreen"),
    exitFullscreen: t("player.exit_fullscreen", "Exit fullscreen"),
    next: t("player.next", "Next episode"),
    back10: t("player.back10", "Back 10 seconds"),
    forward10: t("player.forward10", "Forward 10 seconds"),
    seek: t("player.seek", "Seek"),
    volume: t("player.volume", "Volume"),
    retry: t("common.retry", "Try again"),
    unsupported: t("player.unsupported", "This browser cannot play HLS video."),
    networkError: t("player.network_error", "Playback stopped. Tap to reload."),
    speed: t("player.speed", "speed"),
    subtitles: t("player.subtitles", "Subtitles"),
    subtitlesOff: t("player.subtitles_off", "Off"),
  };
  const subtitleLabel = (code: string) => {
    const l = languages.find((x) => x.code === code);
    return l?.native_name || l?.name || code.toUpperCase();
  };

  const grant = play.kind === "ready" ? play.grant : null;

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-4 sm:px-6 sm:py-8 lg:px-8">
      {/* The player track is sized from the viewport height (9:16), never from its content, so placeholders keep the width. */}
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[min(calc(82svh*9/16),420px)_minmax(0,1fr)] lg:items-start lg:gap-10">
        {/* Player column */}
        <div className="mx-auto w-[min(100%,calc(82svh*9/16))] lg:mx-0 lg:w-full">
          <div className="relative aspect-[9/16] w-full">
            {grant && current ? (
              <VideoPlayer
                key={`${grant.episode_id}-${grant.expires_at}`}
                src={grant.hls_url}
                embedHtml={grant.embed_html}
                poster={current.thumbnail_url ?? series.cover_url}
                title={`${series.title} – ${t("series.episode", "Episode")} ${current.number}`}
                resumeAt={grant.resume_position_sec}
                expiresAt={grant.expires_at}
                autoPlay
                hasNext={!!nextEpisode}
                labels={playerLabels}
                subtitles={grant.subtitles ?? []}
                defaultSubtitleLang={lang}
                subtitleLabel={subtitleLabel}
                beacons={beacons}
                onNext={() => nextEpisode && select(nextEpisode)}
                onEnded={onEnded}
                onProgress={(pos, dur) => putProgress(current.id, pos, dur != null && pos >= dur - 2)}
                onReload={() => dropGrant(current.id)}
              />
            ) : (
              <PlayerPlaceholder
                series={series}
                episode={current}
                state={play}
                onSignIn={openAuth}
                onRetry={() => current && dropGrant(current.id)}
                onUnlock={() => current && setUnlockTarget(current)}
                onConfirmAge={() => setAgeGate({ open: true, retry: "play", busy: false, error: null })}
              />
            )}
          </div>
          {current && (
            <p className="mt-3 text-center text-sm text-ink2 lg:text-start">
              <span className="font-medium text-ink">
                {t("series.episode", "Episode")} {current.number}
              </span>
              {current.title ? ` · ${current.title}` : ""}
            </p>
          )}
        </div>

        {/* Info column */}
        <div className="min-w-0">
          <div className="flex gap-4">
            {series.cover_url && (
              <div className="relative hidden aspect-[9/16] w-24 shrink-0 overflow-hidden rounded-md border border-line sm:block">
                <Image src={series.cover_url} alt="" fill sizes="96px" className="object-cover" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-2xl font-bold leading-tight text-ink sm:text-3xl">{series.title}</h1>
              {/* Classification and the next-episode promise: the two things a viewer decides on and neither was
                  shown anywhere in the product. */}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {series.content_rating && (
                  <span
                    className={`rounded-sm border px-1.5 py-0.5 text-[11px] font-semibold ${
                      series.is_adult ? "border-danger/60 text-danger" : "border-line text-ink2"
                    }`}
                  >
                    {series.content_rating}
                  </span>
                )}
                {series.completion_status && (
                  <span className="rounded-pill bg-surface2 px-2 py-0.5 text-[11px] text-ink2">{series.completion_status}</span>
                )}
                {series.release_note && <span className="text-[11px] text-muted">{series.release_note}</span>}
              </div>
              <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted">
                <span>
                  {series.episode_count} {t("series.episodes_count", "episodes")}
                </span>
                <span>
                  {formatNumber(series.view_count, lang)} {t("series.views", "views")}
                </span>
                <span>
                  {formatNumber(likeCount, lang)} {t("series.likes", "likes")}
                </span>
                {series.is_premium ? (
                  <span className="inline-flex items-center gap-1 text-gold">
                    <IconLock size={12} />
                    {series.free_episodes}{" "}
                    {series.free_episodes === 1
                      ? t("series.free_episode_one", "free episode")
                      : t("series.free_episodes", "free episodes")}
                  </span>
                ) : (
                  <span className="text-success">{t("series.free", "Free")}</span>
                )}
              </p>
              {series.categories.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {series.categories.map((c) => (
                    <li key={c.id} className="rounded-pill border border-line px-2.5 py-0.5 text-xs text-ink2">
                      {c.name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {series.synopsis && (
            <div className="mt-4">
              <p
                ref={synopsisRef}
                className={`text-sm leading-relaxed text-ink2 ${synopsisOpen ? "" : "line-clamp-3"}`}
              >
                {series.synopsis}
              </p>
              {/* Measured rather than guessed from a character count: three clamped lines is ~120 characters at
                  360px and ~260 at desktop, so any fixed threshold is wrong on one of them. */}
              {(synopsisOpen || synopsisClamped) && (
                <button type="button" onClick={() => setSynopsisOpen((v) => !v)} className="mt-1 text-xs font-medium text-accent hover:underline">
                  {synopsisOpen ? t("common.less", "Show less") : t("common.more", "Show more")}
                </button>
              )}
            </div>
          )}

          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" aria-pressed={liked} onClick={() => toggle("like")}>
              <IconHeart size={16} filled={liked} className={liked ? "text-accent" : ""} />
              {liked ? t("series.liked", "Liked") : t("series.like", "Like")}
            </Button>
            <Button variant="secondary" size="sm" aria-pressed={favorite} onClick={() => toggle("favorite")}>
              <IconStar size={16} filled={favorite} className={favorite ? "text-gold" : ""} />
              {favorite ? t("series.in_list", "In My List") : t("series.add_to_list", "My List")}
            </Button>
            <Button variant="secondary" size="sm" onClick={share}>
              <IconShare size={16} />
              {t("series.share", "Share")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => (status === "authenticated" ? setReportOpen(true) : openAuth())}>
              <IconFlag size={16} />
              {t("series.report", "Report")}
            </Button>
          </div>

          <div className="mt-8">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold text-ink">{t("series.episodes", "Episodes")}</h2>
              {status === "authenticated" && (
                <span className="inline-flex items-center gap-1 text-sm text-gold">
                  <IconCoin size={16} />
                  {balance}
                </span>
              )}
            </div>
            <EpisodeGrid episodes={sorted} currentId={currentId} continueNumber={continueNumber} onSelect={(ep) => select(ep)} />
          </div>
        </div>
      </div>

      <UnlockDialog
        episode={unlockTarget}
        balance={balance}
        status={unlockStatus}
        bundle={visibleBundle}
        episodeCount={sorted.length}
        seriesSlug={series.slug}
        onClose={() => {
          setUnlockTarget(null);
          setUnlockStatus({ kind: "idle" });
        }}
        onUnlock={(m) => void unlock(m)}
        onUnlockBundle={() => void unlockBundle()}
      />
      <AgeGateDialog
        open={ageGate.open}
        busy={ageGate.busy}
        error={ageGate.error}
        onConfirm={() => void confirmAge()}
        onClose={() => setAgeGate({ open: false, retry: null, busy: false, error: null })}
      />
      <ReportDialog open={reportOpen} onClose={() => setReportOpen(false)} seriesId={series.id} episodeId={currentId} />
    </div>
  );
}

function PlayerPlaceholder({
  series,
  episode,
  state,
  onSignIn,
  onRetry,
  onUnlock,
  onConfirmAge,
}: {
  series: SeriesDetail;
  episode: EpisodeOut | null;
  state: PlayState;
  onSignIn: () => void;
  onRetry: () => void;
  onUnlock: () => void;
  onConfirmAge: () => void;
}) {
  const t = useT();
  const img = episode?.thumbnail_url ?? series.cover_url;
  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg border border-line bg-surface">
      {img && <Image src={img} alt="" fill sizes="(min-width: 1024px) 460px, 100vw" className="object-cover opacity-40" priority />}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
        {state.kind === "loading" || state.kind === "idle" || state.kind === "ready" ? (
          <Spinner size={36} className="text-ink" />
        ) : state.kind === "auth" ? (
          <>
            <p className="text-sm text-ink2">{t("player.sign_in_to_watch", "Sign in to keep watching — this episode needs an account.")}</p>
            <Button onClick={onSignIn}>
              <IconPlay size={16} />
              {t("auth.sign_in", "Sign in")}
            </Button>
          </>
        ) : state.kind === "age_gate" ? (
          <>
            <p className="text-sm text-ink2">{t("age_gate.player", "This drama is rated for adults.")}</p>
            <Button onClick={onConfirmAge}>{t("age_gate.confirm", "I am 18 or older")}</Button>
          </>
        ) : state.kind === "locked" ? (
          <>
            <IconLock size={32} className="text-gold" />
            <p className="text-sm text-ink2">{t("player.locked", "This episode is locked.")}</p>
            <Button variant="gold" onClick={onUnlock}>
              <IconCoin size={16} />
              {t("unlock.cta", "Unlock")}
            </Button>
          </>
        ) : state.kind === "not_ready" ? (
          <>
            <IconClock size={32} className="text-warning" />
            <p className="text-sm text-ink2">{t("player.asset_not_ready", "This episode is being prepared, try again in a minute.")}</p>
            <Button variant="secondary" onClick={onRetry}>
              {t("common.retry", "Try again")}
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-danger">{state.message}</p>
            <Button variant="secondary" onClick={onRetry}>
              {t("common.retry", "Try again")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
