import { colors, radii, spacing } from "@katha/tokens";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import PagerView, { type PagerViewOnPageSelectedEvent } from "react-native-pager-view";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AgeGateSheet } from "@/components/age-gate";
import { EpisodeGrid, lockState, type EpisodeLockState } from "@/components/episode-grid";
import { Icon } from "@/components/icons";
import { EpisodePage, SPEEDS, type LoadError, type Speed } from "@/components/player/episode-page";
import { safePlayerCall, usePlayerPool } from "@/components/player/player-pool";
import { nextTrackLang, selectTrack, useSubtitlePreference } from "@/components/player/subtitles";
import { UnlockSheet, unlockEpisode, useAutoUnlock } from "@/components/unlock-sheet";
import { Button, ErrorState, Loading, Screen, Text } from "@/components/ui";
import { useQuery } from "@/hooks/use-query";
import { useSeriesActions } from "@/hooks/use-series-actions";
import { useT } from "@/hooks/use-translations";
import { track } from "@/lib/analytics";
import { api } from "@/lib/api";
import { unwrap } from "@/lib/errors";
import { formatCount } from "@/lib/format";
import { grantIsFresh, requestPlay, type Grant } from "@/lib/play";
import { getBool, setBool } from "@/lib/storage";
import type { Episode, SeriesDetail } from "@/lib/types";
import { useAuth } from "@/providers/auth";
import { useConfig } from "@/providers/config";

export default function PlayerRoute() {
  const { seriesId, episode } = useLocalSearchParams<{ seriesId: string; episode?: string }>();
  const { lang } = useConfig();
  const { status } = useAuth();
  const series = useQuery(
    async () => unwrap(await api.GET("/v1/series/{id_or_slug}", { params: { path: { id_or_slug: seriesId }, query: { lang } } })),
    [seriesId, lang, status],
    { enabled: status !== "loading" },
  );

  if (status === "loading" || series.loading) return <Loading />;
  if (series.error || !series.data) {
    return (
      <Screen>
        <ErrorState message={series.error ?? "Series not found"} onRetry={() => series.refetch({ silent: false })} />
      </Screen>
    );
  }
  const initialNumber = Number.parseInt(episode ?? "", 10);
  return (
    <Player
      key={`${series.data.id}:${status}`}
      series={series.data}
      initialNumber={Number.isFinite(initialNumber) ? initialNumber : (series.data.continue_episode_number ?? 1)}
    />
  );
}

type UnlockTarget = { episode: Episode; index: number; reason: "swiped" | "ended" };

/** Seconds between an episode ending and the next one starting on its own. */
const AUTO_ADVANCE_SEC = 4;

function Player({ series, initialNumber }: { series: SeriesDetail; initialNumber: number }) {
  const t = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { lang } = useConfig();
  const { status, balance, setBalance, requireAuth, applyUser } = useAuth();
  const signedIn = status === "signed_in";
  const pool = usePlayerPool();
  const { autoUnlock, setAutoUnlock } = useAutoUnlock();
  const { pref: subtitlePref, choose: chooseSubtitles } = useSubtitlePreference(lang);

  const [episodes, setEpisodes] = useState<Episode[]>(series.episodes);
  const initialIndex = Math.max(
    0,
    episodes.findIndex((e) => e.number === initialNumber),
  );
  const [index, setIndex] = useState(initialIndex);
  const [immersive, setImmersive] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const [grants, setGrants] = useState<Record<string, Grant>>({});
  const [errors, setErrors] = useState<Record<string, LoadError>>({});
  const [unlockTarget, setUnlockTarget] = useState<UnlockTarget | null>(null);
  /** Set when /play answered `age_gate_required`; the sheet retries this episode after the PATCH. */
  const [ageGateFor, setAgeGateFor] = useState<Episode | null>(null);
  const [showEpisodes, setShowEpisodes] = useState(false);
  const [endedLast, setEndedLast] = useState(false);
  const [attempt, setAttempt] = useState(0);
  /** The episode an ended one will roll into, and the seconds left before it does. */
  const [pendingNext, setPendingNext] = useState<{ index: number; number: number } | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(AUTO_ADVANCE_SEC);
  const [coach, setCoach] = useState(false);
  const pagerRef = useRef<PagerView>(null);
  const inflight = useRef(new Set<string>());
  const grantsRef = useRef(grants);
  useEffect(() => {
    grantsRef.current = grants;
  }, [grants]);

  const total = episodes.length;
  const current = episodes[index];
  /**
   * The paywall used to arrive with no warning: a viewer met it by hitting it, mid-cliffhanger, which reads as
   * a trap rather than a price. Saying it one episode early turns the same moment into a decision.
   */
  const nextEpisode = episodes[index + 1];
  const foreshadow =
    current && (current.is_free || current.accessible) && nextEpisode && !(nextEpisode.accessible || nextEpisode.is_free)
      ? nextEpisode.price
      : null;
  const currentLocked = Boolean(current) && !(current.accessible || current.is_free);
  // A swipe onto a locked page shows the unlock sheet for it; "ended" sheets are explicit state.
  const sheet = useMemo<UnlockTarget | null>(
    () => unlockTarget ?? (currentLocked ? { episode: current, index, reason: "swiped" } : null),
    [unlockTarget, currentLocked, current, index],
  );

  const currentGrant = current ? grants[current.id] : undefined;
  const subtitleTracks = useMemo(() => currentGrant?.subtitles ?? [], [currentGrant]);
  const subtitleTrack = useMemo(() => selectTrack(subtitleTracks, subtitlePref), [subtitleTracks, subtitlePref]);
  const cycleSubtitles = useCallback(() => chooseSubtitles(nextTrackLang(subtitleTracks, subtitleTrack)), [chooseSubtitles, subtitleTracks, subtitleTrack]);

  const markAccessible = useCallback((id: string) => {
    setEpisodes((eps) => eps.map((e) => (e.id === id ? { ...e, accessible: true, unlocked: true } : e)));
  }, []);

  /**
   * Ask for a grant and load it into the page's player. After every await the episode may have left the
   * prev/current/next window (fast swipes): then the grant is stored for later but no player is acquired.
   */
  const load = useCallback(
    async (ep: Episode, force = false) => {
      if (!(ep.accessible || ep.is_free)) return;
      if (inflight.current.has(ep.id)) return;
      const existing = grantsRef.current[ep.id];
      if (!force && grantIsFresh(existing)) return;
      inflight.current.add(ep.id);
      try {
        const result = await requestPlay(ep.id);
        if (!result.ok) {
          if (result.code === "locked") {
            setEpisodes((eps) => eps.map((e) => (e.id === ep.id ? { ...e, accessible: false, unlocked: false } : e)));
          }
          if (result.code === "age_gate") {
            // Signed-in viewers confirm 18+ and we retry; guests must sign in before there is a profile to flag.
            setErrors((m) => ({ ...m, [ep.id]: { code: signedIn ? "age_gate" : "unauthorized", message: result.message } }));
            if (signedIn) setAgeGateFor(ep);
            return;
          }
          setErrors((m) => ({ ...m, [ep.id]: { code: result.code, message: result.message } }));
          return;
        }
        setErrors((m) => {
          if (!(ep.id in m)) return m;
          const next = { ...m };
          delete next[ep.id];
          return next;
        });
        if (!result.grant.hls_url || !pool.inWindow(ep.id)) {
          setGrants((g) => ({ ...g, [ep.id]: result.grant }));
          return;
        }
        // Acquire before publishing the grant so the render that sees the grant also finds the player.
        const player = pool.acquire(ep.id);
        const wasPlaying = player.playing;
        const keepPosition = existing ? player.currentTime : 0;
        await player.replaceAsync({ uri: result.grant.hls_url, contentType: "hls" });
        if (!pool.inWindow(ep.id)) {
          setGrants((g) => ({ ...g, [ep.id]: result.grant }));
          return;
        }
        const resume = keepPosition > 0 ? keepPosition : result.grant.resume_position_sec;
        safePlayerCall(player, (p) => {
          if (resume > 0) p.currentTime = resume;
          if (wasPlaying) p.play();
        });
        setGrants((g) => ({ ...g, [ep.id]: result.grant }));
      } finally {
        inflight.current.delete(ep.id);
      }
    },
    [pool, signedIn],
  );

  // Keep the player window at prev/current/next and (pre)load their grants.
  useEffect(() => {
    const window = [index - 1, index, index + 1].filter((i) => i >= 0 && i < total).map((i) => episodes[i]);
    pool.syncWindow(
      window.map((e) => e.id),
      episodes[index]?.id ?? null,
    );
    for (const ep of window) void load(ep);
  }, [index, episodes, total, pool, load, attempt]);

  // Leaving the player releases every instance so the Shorts tab starts from a clean pool.
  useEffect(() => () => pool.releaseAll(), [pool]);

  // The unlock sheet is the paywall: report it once per episode it is shown for.
  const paywallSeen = useRef<string | null>(null);
  useEffect(() => {
    const ep = sheet?.episode;
    if (!ep) {
      paywallSeen.current = null;
      return;
    }
    if (paywallSeen.current === ep.id) return;
    paywallSeen.current = ep.id;
    track("paywall_view", { series_id: series.id, episode_id: ep.id, episode_number: ep.number, price: ep.price, balance, reason: sheet.reason });
  }, [sheet, series.id, balance]);

  const goTo = useCallback((i: number) => {
    pagerRef.current?.setPage(i);
    setIndex(i);
    setEndedLast(false);
    setPendingNext(null);
  }, []);

  /**
   * A first-run coach for the two gestures that are not visible anywhere on screen.
   *
   * Vertical swiping between episodes and hold-for-2x were discoverable only by accident; a viewer who never
   * found them watched one episode and left. Shown once ever, dismissed by tapping anywhere on it.
   */
  useEffect(() => {
    let cancelled = false;
    void getBool("playerCoached").then((seen) => {
      if (!cancelled && !seen) setCoach(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const dismissCoach = useCallback(() => {
    setCoach(false);
    void setBool("playerCoached", true);
  }, []);

  /**
   * Counts the auto-advance down in the open rather than jumping.
   *
   * Ending one episode and instantly being somewhere else removes the choice to stop, which is the moment a
   * viewer most often wants it. The chip advances on its own, and either button resolves it immediately.
   */
  useEffect(() => {
    if (!pendingNext) return;
    const target = pendingNext.index;
    // The interval only drives the label; the timeout is what actually advances, so a dropped tick cannot
    // strand the viewer on a finished episode.
    const tick = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    const advance = setTimeout(() => goTo(target), AUTO_ADVANCE_SEC * 1000);
    return () => {
      clearInterval(tick);
      clearTimeout(advance);
    };
  }, [pendingNext, goTo]);

  const onEnded = useCallback(async () => {
    const nextIndex = index + 1;
    if (nextIndex >= total) {
      setEndedLast(true);
      return;
    }
    const next = episodes[nextIndex];
    if (next.accessible || next.is_free) {
      setSecondsLeft(AUTO_ADVANCE_SEC);
      setPendingNext({ index: nextIndex, number: next.number });
      return;
    }
    if (signedIn && autoUnlock && balance >= next.price) {
      const result = await unlockEpisode(next.id, "coins", setBalance);
      if (result.ok) {
        markAccessible(next.id);
        goTo(nextIndex);
        return;
      }
    }
    setUnlockTarget({ episode: next, index: nextIndex, reason: "ended" });
  }, [index, total, episodes, goTo, signedIn, autoUnlock, balance, setBalance, markAccessible]);

  const onPageSelected = useCallback((e: PagerViewOnPageSelectedEvent) => {
    setIndex(e.nativeEvent.position);
    setUnlockTarget(null);
    setEndedLast(false);
    // A deliberate swipe outranks a pending auto-advance.
    setPendingNext(null);
  }, []);

  const onEpisodePick = useCallback(
    (ep: Episode, state: EpisodeLockState) => {
      if (state === "locked_sequential") return;
      setShowEpisodes(false);
      const i = episodes.findIndex((e) => e.id === ep.id);
      if (i >= 0) goTo(i);
    },
    [episodes, goTo],
  );

  const cycleSpeed = useCallback(() => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length]), []);
  const toggleImmersive = useCallback(() => setImmersive((v) => !v), []);
  const retry = useCallback(() => {
    if (current) {
      setErrors((m) => {
        const next = { ...m };
        delete next[current.id];
        return next;
      });
      void load(current, true);
    }
    setAttempt((a) => a + 1);
  }, [current, load]);
  /** Sign in and come back to this exact episode: the one case where the auth modal needs a returnTo. */
  const signIn = useCallback(
    () => requireAuth(`/player/${series.id}?episode=${current?.number ?? initialNumber}`),
    [requireAuth, series.id, current?.number, initialNumber],
  );

  // Like / save / share / episodes, seeded from the server. Shorts had a rail and the full player — where all
  // the watch time actually happens — had nothing to do but watch, which is a straight regression on the app
  // this replaces.
  const actions = useSeriesActions(series.id, {
    favorite: series.is_favorite,
    liked: series.is_liked,
    likeCount: series.like_count,
  });

  const overlay = useMemo(
    () => (
      <>
      <View style={[styles.top, { paddingTop: insets.top + spacing.sm }]} pointerEvents="box-none">
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)"))} accessibilityRole="button" accessibilityLabel="Back" style={styles.roundBtn}>
          <Icon name="back" size={28} />
        </Pressable>
        <View style={styles.topCenter}>
          <Text variant="label" numberOfLines={1}>
            {series.title}
          </Text>
          <View style={styles.badge}>
            <Text variant="caption" color={colors.ink}>
              Ep {current?.number ?? "-"} / {total}
            </Text>
          </View>
        </View>
        <Pressable onPress={() => setShowEpisodes(true)} accessibilityRole="button" accessibilityLabel={t("series.episodes")} style={styles.roundBtn}>
          <Icon name="episodes" size={20} />
        </Pressable>
      </View>

      {foreshadow !== null ? (
        <View style={[styles.foreshadow, { top: insets.top + 64 }]} pointerEvents="none">
          <View style={styles.foreshadowChip}>
            <Icon name="coin" size={12} />
            <Text variant="caption" color={colors.ink}>
              {t("player.next_costs", { n: foreshadow })}
            </Text>
          </View>
        </View>
      ) : null}

      <View style={[styles.rail, { bottom: insets.bottom + 132 }]} pointerEvents="box-none">
        <RailButton
          icon={actions.liked ? "heart-filled" : "heart"}
          label={formatCount(actions.likeCount)}
          tint={actions.liked ? colors.accent : colors.ink}
          onPress={actions.toggleLike}
        />
        <RailButton
          icon={actions.favorite ? "bookmark-filled" : "bookmark"}
          label={actions.favorite ? t("shorts.saved") : t("shorts.save")}
          tint={actions.favorite ? colors.gold : colors.ink}
          onPress={actions.toggleFavorite}
        />
        <RailButton
          icon="share"
          label={t("shorts.share")}
          onPress={() => actions.share(series.title, series.slug, current?.number)}
        />
      </View>
      </>
    ),
    [insets.top, insets.bottom, router, series.title, series.slug, current?.number, total, t, actions, foreshadow],
  );

  if (total === 0) {
    return (
      <Screen>
        <ErrorState message="This series has no published episodes yet." onRetry={() => router.back()} retryLabel="Back" />
      </Screen>
    );
  }

  return (
    <View style={styles.root}>
      <PagerView
        ref={pagerRef}
        style={styles.pager}
        orientation="vertical"
        initialPage={initialIndex}
        offscreenPageLimit={1}
        onPageSelected={onPageSelected}
        overdrag
      >
        {episodes.map((ep, i) => {
          const near = Math.abs(i - index) <= 1;
          const isCurrent = i === index;
          const accessible = ep.accessible || ep.is_free;
          if (!near) return <View key={ep.id} style={styles.pageWrap} collapsable={false} />;
          return (
            <View key={ep.id} style={styles.pageWrap} collapsable={false}>
              {accessible ? (
                <EpisodePage
                  episodeId={ep.id}
                  seriesId={series.id}
                  active={isCurrent && sheet === null && !showEpisodes && ageGateFor === null}
                  player={grants[ep.id]?.hls_url ? pool.get(ep.id) : null}
                  grant={grants[ep.id] ?? null}
                  loadError={errors[ep.id] ?? null}
                  posterUrl={ep.thumbnail_url ?? series.cover_url}
                  immersive={immersive}
                  onToggleImmersive={toggleImmersive}
                  speed={speed}
                  onCycleSpeed={cycleSpeed}
                  onEnded={onEnded}
                  onRetry={retry}
                  onSignIn={signIn}
                  subtitleTrack={isCurrent ? subtitleTrack : null}
                  subtitleCount={isCurrent ? subtitleTracks.length : 0}
                  onCycleSubtitles={cycleSubtitles}
                  overlay={isCurrent ? overlay : undefined}
                  trackProgress={signedIn}
                  bottomInset={insets.bottom}
                  showReplay={isCurrent && endedLast}
                />
              ) : (
                <View style={styles.lockedPage}>
                  {isCurrent && !immersive ? overlay : null}
                  <View style={styles.lockedBody}>
                    <Icon name="lock" size={36} />
                    <Text variant="heading">Episode {ep.number}</Text>
                    <Text variant="caption">{lockState(ep, episodes) === "locked_sequential" ? t("series.locked_prev") : `${ep.price} coins`}</Text>
                  </View>
                </View>
              )}
            </View>
          );
        })}
      </PagerView>

      {pendingNext && !sheet ? (
        <View style={[styles.nextWrap, { bottom: insets.bottom + spacing.xl }]} pointerEvents="box-none">
          <View style={styles.nextChip}>
            <Text variant="caption" color={colors.ink}>
              {t("player.next_in", { n: pendingNext.number, s: Math.max(0, secondsLeft) })}
            </Text>
            <View style={styles.nextButtons}>
              <Button title={t("player.play_now")} small onPress={() => goTo(pendingNext.index)} />
              <Button title={t("player.stay")} variant="secondary" small onPress={() => setPendingNext(null)} />
            </View>
          </View>
        </View>
      ) : null}

      {coach ? (
        <Pressable style={styles.coach} onPress={dismissCoach} accessibilityRole="button" accessibilityLabel={t("player.coach_got_it")}>
          <View style={styles.coachBody}>
            <Icon name="swipe-up" size={30} />
            <Text variant="heading" color={colors.ink}>
              {t("player.coach_swipe")}
            </Text>
            <Text variant="caption" color={colors.ink}>
              {t("player.coach_tap")}
            </Text>
            <Button title={t("player.coach_got_it")} small onPress={dismissCoach} />
          </View>
        </Pressable>
      ) : null}

      {sheet ? (
        <View style={[styles.sheetWrap, { paddingBottom: insets.bottom }]} pointerEvents="box-none">
          <Pressable style={styles.scrim} onPress={sheet.reason === "ended" ? () => setUnlockTarget(null) : undefined} accessibilityRole="button" accessibilityLabel="Dismiss" />
          <UnlockSheet
            episode={sheet.episode}
            seriesId={series.id}
            total={total}
            autoUnlock={autoUnlock}
            onAutoUnlockChange={setAutoUnlock}
            onClose={sheet.reason === "ended" ? () => setUnlockTarget(null) : undefined}
            onSignIn={signIn}
            onUnlocked={() => {
              markAccessible(sheet.episode.id);
              const target = sheet.index;
              setUnlockTarget(null);
              if (target !== index) goTo(target);
            }}
          />
        </View>
      ) : null}

      {ageGateFor ? (
        <View style={[styles.sheetWrap, { paddingBottom: insets.bottom }]} pointerEvents="box-none">
          <Pressable style={styles.scrim} onPress={() => setAgeGateFor(null)} accessibilityRole="button" accessibilityLabel="Dismiss" />
          <AgeGateSheet
            onCancel={() => setAgeGateFor(null)}
            onConfirmed={(u) => {
              applyUser(u);
              const ep = ageGateFor;
              setAgeGateFor(null);
              setErrors((m) => {
                if (!(ep.id in m)) return m;
                const next = { ...m };
                delete next[ep.id];
                return next;
              });
              void load(ep, true);
            }}
          />
        </View>
      ) : null}

      <Modal visible={showEpisodes} animationType="slide" transparent onRequestClose={() => setShowEpisodes(false)}>
        <Pressable style={styles.scrim} onPress={() => setShowEpisodes(false)} accessibilityRole="button" accessibilityLabel="Close" />
        <View style={[styles.episodesSheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.sheetHeader}>
            <Text variant="title">{t("series.episodes")}</Text>
            <Pressable onPress={() => setShowEpisodes(false)} accessibilityRole="button" accessibilityLabel="Close" hitSlop={10}>
              <Icon name="close" size={24} />
            </Pressable>
          </View>
          <ScrollView>
            <EpisodeGrid episodes={episodes} currentNumber={current?.number} onPress={onEpisodePick} />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

function RailButton({
  icon,
  label,
  onPress,
  tint = colors.ink,
}: {
  icon: Parameters<typeof Icon>[0]["name"];
  label: string;
  onPress: () => void;
  tint?: string;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={styles.railBtn}>
      <View style={styles.roundBtn}>
        <Icon name={icon} size={20} color={tint} />
      </View>
      <Text variant="caption" color={colors.ink}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  pager: { flex: 1 },
  pageWrap: { flex: 1, backgroundColor: "#000" },
  lockedPage: { flex: 1, backgroundColor: colors.ground },
  lockedBody: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  top: { position: "absolute", top: 0, left: 0, right: 0, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md },
  topCenter: { flex: 1, alignItems: "center", gap: 4 },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radii.pill, backgroundColor: "rgba(0,0,0,0.5)" },
  rail: { position: "absolute", right: spacing.md, alignItems: "center", gap: spacing.lg },
  railBtn: { alignItems: "center", gap: 4 },
  roundBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" },
  sheetWrap: { position: "absolute", left: 0, right: 0, bottom: 0, top: 0, justifyContent: "flex-end", backgroundColor: "transparent" },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.5)" } as const,
  episodesSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    maxHeight: "70%",
    paddingTop: spacing.lg,
  },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, marginBottom: spacing.md },
  foreshadow: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  foreshadowChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  nextWrap: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  nextChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: "rgba(0,0,0,0.72)",
  },
  nextButtons: { flexDirection: "row", gap: spacing.sm },
  coach: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.72)", alignItems: "center", justifyContent: "center" },
  coachBody: { alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.xl },
});
