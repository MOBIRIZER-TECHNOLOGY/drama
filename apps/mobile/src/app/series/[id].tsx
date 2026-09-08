import { colors, radii, spacing } from "@katha/tokens";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { EpisodeGrid, type EpisodeLockState } from "@/components/episode-grid";
import { Icon } from "@/components/icons";
import { Rail } from "@/components/rail";
import { Button, ErrorState, Pill, Screen, SectionHeader, Skeleton, Text } from "@/components/ui";
import { useQuery } from "@/hooks/use-query";
import { useSeriesActions } from "@/hooks/use-series-actions";
import { useT } from "@/hooks/use-translations";
import { track } from "@/lib/analytics";
import { api } from "@/lib/api";
import { unwrap } from "@/lib/errors";
import { formatCount } from "@/lib/format";
import type { Episode, SeriesDetail } from "@/lib/types";
import { useAuth } from "@/providers/auth";
import { useConfig } from "@/providers/config";

export default function SeriesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { lang } = useConfig();
  const { status } = useAuth();
  const series = useQuery(
    async () => unwrap(await api.GET("/v1/series/{id_or_slug}", { params: { path: { id_or_slug: id }, query: { lang } } })),
    [id, lang, status],
  );

  if (series.loading) return <SeriesSkeleton />;
  if (series.error || !series.data) {
    return (
      <Screen>
        <BackBar />
        <ErrorState message={series.error ?? "Series not found"} onRetry={() => series.refetch({ silent: false })} />
      </Screen>
    );
  }
  return <SeriesBody series={series.data} />;
}

/**
 * Matches the loaded layout rather than centring a spinner.
 *
 * A spinner on a cold open told the viewer nothing and then shifted every element once the data landed. The
 * blocks below sit where the cover, title, buttons and episode grid will be, so the screen resolves in place.
 */
function SeriesSkeleton() {
  return (
    <Screen edges={["top", "left", "right"]}>
      <BackBar />
      <View style={styles.hero}>
        <Skeleton width={120} height={213} radius={radii.md} />
        <View style={styles.heroText}>
          <Skeleton height={26} width="80%" />
          <Skeleton height={14} width="45%" />
          <Skeleton height={14} width="60%" />
          <View style={styles.actions}>
            <Skeleton height={22} width={44} />
            <Skeleton height={22} width={44} />
          </View>
        </View>
      </View>
      <View style={styles.skeletonBody}>
        <Skeleton height={14} />
        <Skeleton height={14} width="90%" />
        <Skeleton height={48} radius={radii.md} />
        <View style={styles.skeletonGrid}>
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} height={52} width={52} radius={radii.sm} />
          ))}
        </View>
      </View>
    </Screen>
  );
}

function BackBar({ right }: { right?: React.ReactNode }) {
  const router = useRouter();
  return (
    <View style={styles.backBar}>
      <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)"))} accessibilityRole="button" accessibilityLabel="Back" hitSlop={10}>
        <Icon name="back" size={30} />
      </Pressable>
      {right}
    </View>
  );
}

function SeriesBody({ series }: { series: SeriesDetail }) {
  const t = useT();
  const router = useRouter();
  const { status, requireAuth } = useAuth();
  const actions = useSeriesActions(series.id, { favorite: series.is_favorite, liked: series.is_liked, likeCount: series.like_count });
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    track("series_view", { series_id: series.id, slug: series.slug, episode_count: series.episode_count, is_premium: series.is_premium });
    if (status !== "signed_in") return;
    api.POST("/v1/series/{series_id}/view", { params: { path: { series_id: series.id } } }).catch(() => {});
  }, [series.id, series.slug, series.episode_count, series.is_premium, status]);

  const continueNumber = series.continue_episode_number ?? 1;
  const resuming = continueNumber > 1;

  // What the rest of the series costs, said before a viewer taps a locked tile and finds out.
  const locked = series.episodes.filter((e) => !e.is_free && !e.accessible);
  const lockedPrice = locked.reduce((sum, e) => sum + (e.price ?? 0), 0);
  const unitPrice = locked.length > 0 ? Math.round(lockedPrice / locked.length) : 0;
  const firstLocked = locked[0]?.number;
  // Free episodes still ahead of where this viewer left off; null until they have actually started.
  const freeLeft = resuming ? Math.max(0, series.free_episodes - (continueNumber - 1)) || null : null;

  const play = useCallback(
    (episodeNumber: number) => {
      // Free episodes play for guests; anything locked needs an account before the unlock sheet makes sense.
      const target = series.episodes.find((e) => e.number === episodeNumber);
      const playable = !target || target.is_free || target.accessible;
      if (!playable && !requireAuth(`/player/${series.id}?episode=${episodeNumber}`)) return;
      router.push({ pathname: "/player/[seriesId]", params: { seriesId: series.id, episode: String(episodeNumber) } });
    },
    [requireAuth, router, series.id, series.episodes],
  );

  const onEpisode = useCallback(
    (ep: Episode, state: EpisodeLockState) => {
      if (state === "locked_sequential") {
        setNotice(t("series.locked_prev"));
        return;
      }
      setNotice(null);
      // Unlockable episodes open the player, which shows the unlock sheet with balance and price.
      play(ep.number);
    },
    [play, t],
  );

  return (
    <Screen edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <BackBar
          right={
            <Pressable onPress={() => actions.share(series.title, series.slug)} accessibilityRole="button" accessibilityLabel="Share" hitSlop={10}>
              <Icon name="share" size={24} />
            </Pressable>
          }
        />
        <View style={styles.hero}>
          <Image source={series.cover_url} style={styles.cover} contentFit="cover" transition={200} />
          <View style={styles.heroText}>
            <Text variant="title">{series.title}</Text>
            <View style={styles.meta}>
              {series.is_premium ? <Pill label="VIP" tone="gold" /> : null}
              {series.categories.slice(0, 2).map((c) => (
                <Pill key={c.id} label={c.name} />
              ))}
            </View>
            <Text variant="caption">
              {series.episode_count} episodes · {series.free_episodes} free · {formatCount(series.view_count)} views
            </Text>
            <View style={styles.actions}>
              <Pressable onPress={actions.toggleLike} accessibilityRole="button" style={styles.action}>
                <Icon name={actions.liked ? "heart-filled" : "heart"} size={22} color={actions.liked ? colors.accent : colors.ink} />
                <Text variant="caption">{formatCount(actions.likeCount)}</Text>
              </Pressable>
              <Pressable onPress={actions.toggleFavorite} accessibilityRole="button" style={styles.action}>
                <Icon name={actions.favorite ? "bookmark-filled" : "bookmark"} size={22} color={actions.favorite ? colors.gold : colors.ink} />
                <Text variant="caption">{actions.favorite ? "Saved" : "Save"}</Text>
              </Pressable>
            </View>
          </View>
        </View>

        {series.synopsis ? (
          <Text variant="body" style={styles.synopsis}>
            {series.synopsis}
          </Text>
        ) : null}

        <View style={styles.playRow}>
          <Button
            title={resuming ? t("series.continue") : t("common.play")}
            subtitle={resuming ? t("series.episode_n", { n: continueNumber }) : undefined}
            onPress={() => play(continueNumber)}
            left={<Icon name="play" size={14} color={colors.accentInk} />}
            style={{ flex: 1 }}
          />
          {/* Restarting was only reachable by scrolling to episode 1 in the grid, which a returning viewer
              rarely thinks to do — and a shared link that resumes mid-series is the common way in. */}
          {resuming ? <Button title={t("series.start_over")} variant="secondary" onPress={() => play(1)} /> : null}
        </View>

        {actions.error ? (
          <Text variant="caption" color={colors.danger} style={styles.notice}>
            {actions.error}
          </Text>
        ) : null}

        <SectionHeader title={t("series.episodes")} right={<Text variant="caption">{series.episodes.length}</Text>} />
        {/* The price belongs above the grid: finding it by tapping a padlock is finding it too late. */}
        {locked.length > 0 ? (
          <View style={styles.priceRow}>
            <Text variant="caption">{t("series.locked_summary", { n: locked.length, price: unitPrice })}</Text>
            {firstLocked ? (
              <Pressable onPress={() => play(firstLocked)} accessibilityRole="button" hitSlop={8}>
                <Text variant="caption" color={colors.accent}>
                  {t("series.unlock_all", { price: lockedPrice })}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : series.free_episodes > 0 && series.episode_count > series.free_episodes ? (
          <View style={styles.priceRow}>
            {/* Counting down is the point: "3 free left" is a reason to keep going and a warning about the
                wall; "first 5 are free" stops being information the moment the viewer starts watching. */}
            <Text variant="caption">
              {freeLeft === null
                ? t("series.free_first", { n: series.free_episodes })
                : freeLeft === 1
                  ? t("series.free_left_one")
                  : t("series.free_left", { n: freeLeft })}
            </Text>
          </View>
        ) : null}
        {series.episodes.length === 0 ? (
          <Text variant="caption" style={styles.notice}>
            No episodes published yet.
          </Text>
        ) : (
          <EpisodeGrid episodes={series.episodes} currentNumber={series.continue_episode_number} onPress={onEpisode} />
        )}
        {notice ? (
          <Text variant="caption" color={colors.warning} style={styles.notice}>
            {notice}
          </Text>
        ) : null}

        <Rail title={t("series.similar")} items={series.similar} />
        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.xl },
  backBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  hero: { flexDirection: "row", gap: spacing.lg, paddingHorizontal: spacing.lg },
  cover: { width: 120, height: 213, borderRadius: radii.md, backgroundColor: colors.surface2, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  heroText: { flex: 1, gap: spacing.sm, justifyContent: "flex-start" },
  meta: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  actions: { flexDirection: "row", gap: spacing.xl, marginTop: spacing.sm },
  action: { alignItems: "center", gap: 2 },
  synopsis: { paddingHorizontal: spacing.lg, marginTop: spacing.lg },
  playRow: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, marginTop: spacing.lg },
  priceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  skeletonBody: { paddingHorizontal: spacing.lg, marginTop: spacing.lg, gap: spacing.sm },
  skeletonGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
  notice: { paddingHorizontal: spacing.lg, marginTop: spacing.sm },
});
