import { colors, radii, spacing } from "@katha/tokens";
import * as Haptics from "expo-haptics";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import PagerView, { type PagerViewOnPageSelectedEvent } from "react-native-pager-view";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/icons";
import { EpisodePage, type LoadError } from "@/components/player/episode-page";
import { usePlayerPool } from "@/components/player/player-pool";
import { UnlockSheet, useAutoUnlock } from "@/components/unlock-sheet";
import { Button, EmptyState, ErrorState, Skeleton, Text } from "@/components/ui";
import { useQuery } from "@/hooks/use-query";
import { useSeriesActions } from "@/hooks/use-series-actions";
import { useT } from "@/hooks/use-translations";
import { track } from "@/lib/analytics";
import { api } from "@/lib/api";
import { unwrap } from "@/lib/errors";
import { formatCount } from "@/lib/format";
import { grantIsFresh, requestPlay, type Grant } from "@/lib/play";
import { getBool, setBool } from "@/lib/storage";
import type { ShortItem } from "@/lib/types";
import { useAuth } from "@/providers/auth";
import { useConfig } from "@/providers/config";

/** Fetch the next page this far from the end, so the feed never visibly runs out. */
const PREFETCH_WITHIN = 4;

/**
 * The vertical feed.
 *
 * This is the surface the whole format exists for, and it used to be twelve first-episodes of twelve different
 * series in a fixed order: a swipe abandoned the story it had just hooked you with, the feed hit a wall after
 * twelve, and the paywall — the thing the feed is supposed to lead to — never appeared at all.
 *
 * It now reads `/v1/shorts`, which chains episodes within a series up to and including the first locked one, and
 * paginates. Swiping continues the story, reaches the cliffhanger, and offers to unlock it without leaving the
 * feed. Sound is on by default, because vertical drama is dialogue and a muted first frame converts far worse.
 */
export default function ShortsScreen() {
  const t = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { lang } = useConfig();
  const { status, requireAuth } = useAuth();
  const pool = usePlayerPool();
  const { autoUnlock, setAutoUnlock } = useAutoUnlock();

  const first = useQuery(async () => unwrap(await api.GET("/v1/shorts", { params: { query: { lang } } })), [lang, status], {
    enabled: status !== "loading",
  });

  /**
   * Pages fetched after the first, tagged with the language they belong to. Keying the object rather than
   * resetting it from an effect means a language change simply makes the old pages stop matching, with no
   * cascading render and no window where the feed shows another language's episodes.
   */
  const [pages, setPages] = useState<{ lang: string; items: ShortItem[]; cursor: string | null } | null>(null);
  const loadingMore = useRef(false);

  const [index, setIndex] = useState(0);
  const [focused, setFocused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [showMuteHint, setShowMuteHint] = useState(true);
  const [grants, setGrants] = useState<Record<string, Grant>>({});
  const [errors, setErrors] = useState<Record<string, LoadError>>({});
  const inflight = useRef(new Set<string>());
  const grantsRef = useRef(grants);
  useEffect(() => {
    grantsRef.current = grants;
  }, [grants]);

  const paged = pages?.lang === lang ? pages : null;
  const items = useMemo(() => [...(first.data?.items ?? []), ...(paged?.items ?? [])], [first.data, paged]);
  const cursor = paged ? paged.cursor : (first.data?.next_cursor ?? null);

  useEffect(() => {
    void getBool("muted", false).then(setMuted);
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMore.current || !cursor) return;
    loadingMore.current = true;
    try {
      const page = unwrap(await api.GET("/v1/shorts", { params: { query: { lang, cursor } } }));
      setPages((prev) => {
        const base = prev?.lang === lang ? prev.items : [];
        const seen = new Set(base.map((i) => i.episode_id));
        return { lang, items: [...base, ...page.items.filter((i) => !seen.has(i.episode_id))], cursor: page.next_cursor ?? null };
      });
    } catch {
      // A failed page just means the feed pauses here; the next swipe retries.
    } finally {
      loadingMore.current = false;
    }
  }, [cursor, lang]);

  // The pool is shared with the full-screen player: hand it over cleanly on blur and rebuild on focus.
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => {
        setFocused(false);
        pool.releaseAll();
      };
    }, [pool]),
  );

  const load = useCallback(
    async (i: number, force = false) => {
      const item = items[i];
      if (!item || !item.accessible) return; // a locked page shows the offer, not a player
      const episodeId = item.episode_id;
      if (inflight.current.has(episodeId)) return;
      if (!force && grantIsFresh(grantsRef.current[episodeId]) && pool.get(episodeId)) return;
      inflight.current.add(episodeId);
      try {
        let grant = grantsRef.current[episodeId];
        if (force || !grantIsFresh(grant)) {
          const result = await requestPlay(episodeId);
          if (!result.ok) {
            setErrors((m) => ({ ...m, [episodeId]: { code: result.code, message: result.message } }));
            return;
          }
          grant = result.grant;
        }
        if (!grant.hls_url || !pool.inWindow(episodeId)) {
          setGrants((g) => ({ ...g, [episodeId]: grant }));
          return;
        }
        const player = pool.acquire(episodeId);
        await player.replaceAsync({ uri: grant.hls_url, contentType: "hls" });
        setGrants((g) => ({ ...g, [episodeId]: grant }));
        setErrors((m) => {
          if (!(episodeId in m)) return m;
          const next = { ...m };
          delete next[episodeId];
          return next;
        });
      } finally {
        inflight.current.delete(episodeId);
      }
    },
    [items, pool],
  );

  useEffect(() => {
    if (!focused) return;
    const window = [index - 1, index, index + 1].filter((i) => i >= 0 && i < items.length);
    const ids = window.filter((i) => items[i].accessible).map((i) => items[i].episode_id);
    pool.syncWindow(ids, items[index]?.accessible ? items[index].episode_id : null);
    for (const i of window) void load(i);
  }, [index, items, pool, load, focused]);

  const onPageSelected = useCallback(
    (e: PagerViewOnPageSelectedEvent) => {
      const next = e.nativeEvent.position;
      setIndex(next);
      setShowMuteHint(false);
      // The highest-frequency gesture in the app had no feedback at all.
      Haptics.selectionAsync().catch(() => {});
      const item = items[next];
      if (item) track("shorts_swipe", { position: next, series_id: item.series_id, episode_number: item.episode_number });
      // Fetching from the swipe rather than from an effect: it is the swipe that consumes the feed, and an
      // effect here would set state on every render pass that touched the index.
      if (next >= items.length - PREFETCH_WITHIN) void loadMore();
    },
    [items, loadMore],
  );

  const toggleMute = useCallback(() => {
    setShowMuteHint(false);
    setMuted((m) => {
      void setBool("muted", !m);
      return !m;
    });
  }, []);

  const markAccessible = useCallback(
    (episodeId: string) => {
      setPages((prev) =>
        prev ? { ...prev, items: prev.items.map((i) => (i.episode_id === episodeId ? { ...i, accessible: true } : i)) } : prev,
      );
      // The first page lives in the query cache, so patch it there too.
      first.setData((prev) =>
        prev ? { ...prev, items: prev.items.map((i) => (i.episode_id === episodeId ? { ...i, accessible: true } : i)) } : prev,
      );
    },
    [first],
  );

  const signIn = useCallback(() => requireAuth(), [requireAuth]);
  const noop = useCallback(() => {}, []);

  // The paywall appears the moment a locked page becomes current — the cliffhanger is still on screen, which is
  // exactly when the offer converts. Derived rather than stored, so unlocking (which flips `accessible`)
  // dismisses it without a second state update.
  const current = items[index] ?? null;
  const unlockFor = current && !current.accessible ? current : null;

  if (first.loading || status === "loading") {
    // The feed is one full-bleed frame at a time; a centred spinner on black read as a failed video.
    return (
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        <Skeleton height={0} radius={0} style={{ flex: 1, height: undefined }} />
      </View>
    );
  }
  if (first.error && !first.data)
    return <ErrorState message={first.error} onRetry={() => first.refetch({ silent: false })} retryLabel={t("common.retry")} />;
  if (items.length === 0) return <EmptyState title={t("home.empty")} />;

  return (
    <View style={styles.root}>
      <PagerView style={styles.pager} orientation="vertical" initialPage={0} offscreenPageLimit={1} onPageSelected={onPageSelected} overdrag>
        {items.map((item, i) => {
          const near = Math.abs(i - index) <= 1;
          const isCurrent = i === index;
          if (!near) return <View key={item.episode_id} style={styles.pageWrap} collapsable={false} />;
          return (
            <View key={item.episode_id} style={styles.pageWrap} collapsable={false}>
              <EpisodePage
                episodeId={item.episode_id}
                seriesId={item.series_id}
                surface="shorts"
                active={focused && isCurrent && item.accessible}
                player={focused && item.accessible && grants[item.episode_id]?.hls_url ? pool.get(item.episode_id) : null}
                grant={grants[item.episode_id] ?? null}
                loadError={errors[item.episode_id] ?? null}
                posterUrl={item.thumbnail_url ?? item.cover_url}
                immersive={false}
                onToggleImmersive={noop}
                speed={1}
                onCycleSpeed={noop}
                onEnded={noop}
                onRetry={() => load(i, true)}
                onSignIn={signIn}
                trackProgress={false}
                muted={muted}
                bottomInset={insets.bottom}
                overlay={
                  isCurrent ? (
                    <ShortOverlay
                      item={item}
                      index={i}
                      total={items.length}
                      muted={muted}
                      showMuteHint={showMuteHint && i === 0}
                      showSwipeHint={i === 0}
                      onToggleMute={toggleMute}
                      topInset={insets.top}
                      bottomInset={insets.bottom}
                      onWatchFull={() =>
                        router.push({
                          pathname: "/player/[seriesId]",
                          params: { seriesId: item.series_id, episode: String(item.episode_number) },
                        })
                      }
                    />
                  ) : undefined
                }
              />
            </View>
          );
        })}
      </PagerView>

      {unlockFor ? (
        <View style={[styles.sheetWrap, { paddingBottom: insets.bottom }]} pointerEvents="box-none">
          <UnlockSheet
            episode={{
              id: unlockFor.episode_id,
              number: unlockFor.episode_number,
              title: unlockFor.episode_title,
              thumbnail_url: unlockFor.thumbnail_url,
              duration_sec: unlockFor.duration_sec,
              is_free: unlockFor.is_free,
              price: unlockFor.price,
              accessible: unlockFor.accessible,
              unlocked: false,
            }}
            seriesId={unlockFor.series_id}
            total={unlockFor.episode_count}
            autoUnlock={autoUnlock}
            onAutoUnlockChange={setAutoUnlock}
            onSignIn={signIn}
            onUnlocked={() => {
              // Flipping `accessible` is what dismisses the sheet: `unlockFor` is derived from the current page.
              markAccessible(unlockFor.episode_id);
              void load(index, true);
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

function ShortOverlay({
  item,
  index,
  total,
  muted,
  showMuteHint,
  showSwipeHint,
  onToggleMute,
  topInset,
  bottomInset,
  onWatchFull,
}: {
  item: ShortItem;
  index: number;
  total: number;
  muted: boolean;
  showMuteHint: boolean;
  showSwipeHint: boolean;
  onToggleMute: () => void;
  topInset: number;
  bottomInset: number;
  onWatchFull: () => void;
}) {
  const t = useT();
  const router = useRouter();
  // Seeded from the server, so a series the viewer already saved renders saved. Seeding these to false meant a
  // tap on an already-saved series silently removed it — a data-integrity bug the viewer reads as lost data.
  const actions = useSeriesActions(item.series_id, {
    favorite: item.is_favorite,
    liked: item.is_liked,
    likeCount: 0,
  });
  const caption = useMemo(() => (item.synopsis ?? "").trim(), [item.synopsis]);
  const genre = item.categories[0]?.name;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View style={[styles.topRow, { paddingTop: topInset + spacing.sm }]} pointerEvents="box-none">
        <Text variant="heading" color={colors.ink}>
          {t("tabs.shorts")}
        </Text>
        <Pressable
          onPress={onToggleMute}
          accessibilityRole="button"
          accessibilityLabel={muted ? t("player.unmute") : t("player.mute")}
          style={styles.roundBtn}
        >
          <Icon name={muted ? "mute" : "unmute"} size={16} />
        </Pressable>
      </View>

      {showMuteHint ? (
        <View style={styles.centreHint} pointerEvents="none">
          <Text variant="caption" color={colors.ink}>
            {muted ? t("shorts.tap_unmute") : t("shorts.sound_on")}
          </Text>
        </View>
      ) : null}

      <View style={[styles.rail, { bottom: bottomInset + 132 }]} pointerEvents="box-none">
        <RailButton
          icon={actions.liked ? "heart-filled" : "heart"}
          label={formatCount(actions.likeCount)}
          onPress={actions.toggleLike}
          tint={actions.liked ? colors.accent : colors.ink}
        />
        <RailButton
          icon={actions.favorite ? "bookmark-filled" : "bookmark"}
          label={actions.favorite ? t("shorts.saved") : t("shorts.save")}
          onPress={actions.toggleFavorite}
          tint={actions.favorite ? colors.gold : colors.ink}
        />
        <RailButton
          icon="episodes"
          label={`${item.episode_count} ep`}
          onPress={() => router.push({ pathname: "/series/[id]", params: { id: item.series_id } })}
        />
        <RailButton icon="share" label={t("shorts.share")} onPress={() => actions.share(item.title, item.slug, item.episode_number)} />
      </View>

      <View style={[styles.captionBox, { bottom: bottomInset + 56 }]} pointerEvents="box-none">
        <View style={styles.metaRow}>
          {genre ? (
            <View style={styles.genrePill}>
              <Text variant="caption" color={colors.accentInk}>
                {genre}
              </Text>
            </View>
          ) : null}
          <Text variant="caption" color={colors.ink2}>
            {t("player.unlock_position", { n: item.episode_number, total: item.episode_count })}
          </Text>
        </View>
        <Text variant="title" numberOfLines={1}>
          {item.title}
        </Text>
        {caption ? (
          <Text variant="body" color={colors.ink2} numberOfLines={2}>
            {caption}
          </Text>
        ) : null}
        <Button
          title={t("shorts.watch_full")}
          onPress={onWatchFull}
          small
          style={styles.watchFull}
          left={<Icon name="play" size={12} color={colors.accentInk} />}
        />
        {showSwipeHint ? (
          <Text variant="caption" color={colors.muted}>
            {t("shorts.swipe_hint")}
          </Text>
        ) : null}
      </View>

      {/* Position in the feed, so a swipe is a decision rather than a leap. */}
      <View style={[styles.progress, { top: topInset }]} pointerEvents="none">
        <View style={[styles.progressFill, { width: `${((index + 1) / Math.max(1, total)) * 100}%` }]} />
      </View>
    </View>
  );
}

function RailButton({ icon, label, onPress, tint = colors.ink }: { icon: Parameters<typeof Icon>[0]["name"]; label: string; onPress: () => void; tint?: string }) {
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
  topRow: { position: "absolute", top: 0, left: 0, right: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg },
  rail: { position: "absolute", right: spacing.md, alignItems: "center", gap: spacing.lg },
  railBtn: { alignItems: "center", gap: 4 },
  roundBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" },
  captionBox: { position: "absolute", left: spacing.lg, right: 80, gap: spacing.xs },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  genrePill: { backgroundColor: colors.accent, borderRadius: 999, paddingHorizontal: spacing.sm, paddingVertical: 1 },
  watchFull: { alignSelf: "flex-start", marginTop: spacing.sm, borderRadius: radii.pill },
  centreHint: { position: "absolute", top: "46%", alignSelf: "center", backgroundColor: "rgba(0,0,0,0.55)", paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: 999 },
  progress: { position: "absolute", left: 0, right: 0, height: 2, backgroundColor: "rgba(255,255,255,0.15)" },
  progressFill: { height: 2, backgroundColor: colors.accent },
  sheetWrap: { position: "absolute", left: 0, right: 0, bottom: 0 },
});
