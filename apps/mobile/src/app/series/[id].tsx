import { colors, radii, spacing } from "@katha/tokens";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { EpisodeGrid, type EpisodeLockState } from "@/components/episode-grid";
import { Icon } from "@/components/icons";
import { Rail } from "@/components/rail";
import { Button, ErrorState, Loading, Pill, Screen, SectionHeader, Text } from "@/components/ui";
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

  if (series.loading) return <Loading />;
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
            title={continueNumber > 1 ? `${t("common.play")} · Episode ${continueNumber}` : t("common.play")}
            onPress={() => play(continueNumber)}
            left={<Icon name="play" size={14} color={colors.accentInk} />}
            style={{ flex: 1 }}
          />
        </View>

        {actions.error ? (
          <Text variant="caption" color={colors.danger} style={styles.notice}>
            {actions.error}
          </Text>
        ) : null}

        <SectionHeader title={t("series.episodes")} right={<Text variant="caption">{series.episodes.length}</Text>} />
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
  playRow: { flexDirection: "row", paddingHorizontal: spacing.lg, marginTop: spacing.lg },
  notice: { paddingHorizontal: spacing.lg, marginTop: spacing.sm },
});
