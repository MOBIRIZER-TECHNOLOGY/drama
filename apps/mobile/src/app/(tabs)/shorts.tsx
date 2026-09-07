import { colors, radii, spacing } from "@katha/tokens";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import PagerView, { type PagerViewOnPageSelectedEvent } from "react-native-pager-view";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/icons";
import { EpisodePage, type LoadError } from "@/components/player/episode-page";
import { usePlayerPool } from "@/components/player/player-pool";
import { Button, EmptyState, ErrorState, Loading, Text } from "@/components/ui";
import { useQuery } from "@/hooks/use-query";
import { useSeriesActions } from "@/hooks/use-series-actions";
import { useT } from "@/hooks/use-translations";
import { api } from "@/lib/api";
import { unwrap } from "@/lib/errors";
import { formatCount } from "@/lib/format";
import { grantIsFresh, requestPlay, type Grant } from "@/lib/play";
import { getBool, setBool } from "@/lib/storage";
import type { SeriesCard } from "@/lib/types";
import { useAuth } from "@/providers/auth";
import { useConfig } from "@/providers/config";

const FEED_SIZE = 12;

/** Episode 1 of featured and top series, in rail order. `first_episode_id` comes with the card. */
function buildFeed(rails: { key: string; items: SeriesCard[] }[] | undefined): SeriesCard[] {
  const seen = new Set<string>();
  const list: SeriesCard[] = [];
  for (const key of ["featured", "top_picks", "newest"]) {
    for (const s of rails?.find((r) => r.key === key)?.items ?? []) {
      if (!s.first_episode_id || seen.has(s.id) || list.length >= FEED_SIZE) continue;
      seen.add(s.id);
      list.push(s);
    }
  }
  return list;
}

/** Vertical feed of first episodes. Guests can watch (episode 1 is free); each page owns one muted-by-default player. */
export default function ShortsScreen() {
  const t = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { lang } = useConfig();
  const { status, requireAuth } = useAuth();
  const pool = usePlayerPool();

  const home = useQuery(async () => unwrap(await api.GET("/v1/home", { params: { query: { lang } } })), [lang, status], {
    enabled: status !== "loading",
  });
  const [index, setIndex] = useState(0);
  const [focused, setFocused] = useState(false);
  const [muted, setMuted] = useState(true);
  const [grants, setGrants] = useState<Record<string, Grant>>({});
  const [errors, setErrors] = useState<Record<string, LoadError>>({});
  const inflight = useRef(new Set<string>());
  const grantsRef = useRef(grants);
  useEffect(() => {
    grantsRef.current = grants;
  }, [grants]);

  const items = useMemo(() => buildFeed(home.data?.rails), [home.data]);

  useEffect(() => {
    getBool("muted", true).then(setMuted);
  }, []);

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
      const episodeId = item?.first_episode_id;
      if (!episodeId || inflight.current.has(episodeId)) return;
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
    const ids = window.map((i) => items[i].first_episode_id).filter((id): id is string => typeof id === "string");
    pool.syncWindow(ids, items[index]?.first_episode_id ?? null);
    for (const i of window) void load(i);
  }, [index, items, pool, load, focused]);

  const onPageSelected = useCallback((e: PagerViewOnPageSelectedEvent) => setIndex(e.nativeEvent.position), []);
  const toggleMute = useCallback(() => {
    setMuted((m) => {
      void setBool("muted", !m);
      return !m;
    });
  }, []);
  const signIn = useCallback(() => requireAuth(), [requireAuth]);
  const noop = useCallback(() => {}, []);

  if (home.loading || status === "loading") return <Loading />;
  if (home.error && !home.data) return <ErrorState message={home.error} onRetry={() => home.refetch({ silent: false })} retryLabel={t("common.retry")} />;
  if (items.length === 0) return <EmptyState title={t("home.empty")} />;

  return (
    <View style={styles.root}>
      <PagerView style={styles.pager} orientation="vertical" initialPage={0} offscreenPageLimit={1} onPageSelected={onPageSelected} overdrag>
        {items.map((series, i) => {
          const near = Math.abs(i - index) <= 1;
          const isCurrent = i === index;
          const epId = series.first_episode_id ?? series.id;
          if (!near) return <View key={series.id} style={styles.pageWrap} collapsable={false} />;
          return (
            <View key={series.id} style={styles.pageWrap} collapsable={false}>
              <EpisodePage
                episodeId={epId}
                seriesId={series.id}
                surface="shorts"
                active={focused && isCurrent}
                player={focused && grants[epId]?.hls_url ? pool.get(epId) : null}
                grant={grants[epId] ?? null}
                loadError={errors[epId] ?? null}
                posterUrl={series.cover_url}
                immersive={false}
                onToggleImmersive={noop}
                speed={1}
                onCycleSpeed={noop}
                onEnded={noop}
                onRetry={() => load(i, true)}
                onSignIn={signIn}
                trackProgress={false}
                muted={muted}
                bottomInset={0}
                overlay={
                  isCurrent ? (
                    <ShortOverlay
                      series={series}
                      muted={muted}
                      onToggleMute={toggleMute}
                      topInset={insets.top}
                      onWatchFull={() => router.push({ pathname: "/player/[seriesId]", params: { seriesId: series.id, episode: "1" } })}
                    />
                  ) : undefined
                }
              />
            </View>
          );
        })}
      </PagerView>
    </View>
  );
}

function ShortOverlay({
  series: s,
  muted,
  onToggleMute,
  topInset,
  onWatchFull,
}: {
  series: SeriesCard;
  muted: boolean;
  onToggleMute: () => void;
  topInset: number;
  onWatchFull: () => void;
}) {
  const router = useRouter();
  // Cards do not carry the viewer's favourite/like state; the toggles report the server truth after the first tap.
  const actions = useSeriesActions(s.id, { favorite: false, liked: false, likeCount: s.like_count });
  const caption = useMemo(() => (s.synopsis ?? "").trim(), [s.synopsis]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View style={[styles.topRow, { paddingTop: topInset + spacing.sm }]} pointerEvents="box-none">
        <Text variant="heading" color={colors.ink}>
          Shorts
        </Text>
        <Pressable onPress={onToggleMute} accessibilityRole="button" accessibilityLabel={muted ? "Unmute" : "Mute"} style={styles.roundBtn}>
          <Icon name={muted ? "mute" : "unmute"} size={16} />
        </Pressable>
      </View>

      <View style={styles.rail} pointerEvents="box-none">
        <RailButton icon={actions.liked ? "heart-filled" : "heart"} label={formatCount(actions.likeCount)} onPress={actions.toggleLike} tint={actions.liked ? colors.accent : colors.ink} />
        <RailButton icon={actions.favorite ? "bookmark-filled" : "bookmark"} label={actions.favorite ? "Saved" : "Save"} onPress={actions.toggleFavorite} tint={actions.favorite ? colors.gold : colors.ink} />
        <RailButton icon="episodes" label={`${s.episode_count} ep`} onPress={() => router.push({ pathname: "/series/[id]", params: { id: s.id } })} />
        <RailButton icon="share" label="Share" onPress={() => actions.share(s.title, s.slug)} />
      </View>

      <View style={styles.captionBox} pointerEvents="box-none">
        <Text variant="title" numberOfLines={1}>
          {s.title}
        </Text>
        {caption ? (
          <Text variant="body" color={colors.ink2} numberOfLines={2}>
            {caption}
          </Text>
        ) : null}
        <Button title="Watch Full" onPress={onWatchFull} small style={styles.watchFull} left={<Icon name="play" size={12} color={colors.accentInk} />} />
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
  rail: { position: "absolute", right: spacing.md, bottom: 150, alignItems: "center", gap: spacing.lg },
  railBtn: { alignItems: "center", gap: 4 },
  roundBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" },
  captionBox: { position: "absolute", left: spacing.lg, right: 80, bottom: 70, gap: spacing.xs },
  watchFull: { alignSelf: "flex-start", marginTop: spacing.sm, borderRadius: radii.pill },
});
