import { colors, radii, spacing } from "@katha/tokens";
import { FlashList } from "@shopify/flash-list";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useRef } from "react";
import { Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { FeaturedSlider } from "@/components/featured-slider";
import { Icon } from "@/components/icons";
import { Rail } from "@/components/rail";
import { CARD_WIDTH, SeriesCard } from "@/components/series-card";
import { EmptyState, ErrorState, Screen, SectionHeader, Skeleton, Text } from "@/components/ui";
import { useQuery } from "@/hooks/use-query";
import { useT } from "@/hooks/use-translations";
import { api } from "@/lib/api";
import { unwrap } from "@/lib/errors";
import type { HomeRail, SeriesCard as SeriesCardModel } from "@/lib/types";
import { useAuth } from "@/providers/auth";
import { useConfig } from "@/providers/config";

export default function HomeScreen() {
  const t = useT();
  const router = useRouter();
  const { lang, config, configError, dismissConfigError, reloadConfig } = useConfig();
  const { status, balance } = useAuth();
  const signedIn = status === "signed_in";

  // `status` in deps: the `continue` rail is per user, so re-fetch after sign in/out.
  const home = useQuery(async () => unwrap(await api.GET("/v1/home", { params: { query: { lang } } })), [lang, status], {
    enabled: status !== "loading",
  });

  // Refresh when returning to the tab so Continue Watching reflects progress made in the player.
  const refetchHome = home.refetch;
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      if (signedIn) void refetchHome({ silent: true });
    }, [signedIn, refetchHome]),
  );

  // `for_you` is personalised (present only for signed-in viewers with history) and sits right after
  // Continue Watching, above the editorial rails.
  const rails = useMemo(() => {
    const all = home.data?.rails ?? [];
    const featured = all.find((r) => r.key === "featured");
    const cont = all.find((r) => r.key === "continue");
    const forYou = all.find((r) => r.key === "for_you");
    const rest = all.filter((r) => r.key !== "featured" && r.key !== "continue" && r.key !== "for_you");
    return { featured, cont, forYou, rest };
  }, [home.data]);

  const onRefresh = useCallback(() => void refetchHome({ silent: true }), [refetchHome]);

  return (
    <Screen>
      <View style={styles.header}>
        <Text variant="display" style={styles.brand}>
          {config.site.name ?? "Katha"}
        </Text>
        <View style={styles.headerRight}>
          {signedIn ? (
            <Pressable onPress={() => router.push("/wallet")} accessibilityRole="button" style={styles.coins}>
              <Icon name="coin" size={14} />
              <Text variant="label">{balance}</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={() => router.push("/search")} accessibilityRole="button" accessibilityLabel={t("home.search")} hitSlop={8}>
            <Icon name="search" size={24} />
          </Pressable>
        </View>
      </View>

      {configError ? (
        <View style={styles.banner}>
          <Text variant="caption" color={colors.ink} style={{ flex: 1 }}>
            {t("home.config_stale", { error: configError })}
          </Text>
          <Pressable onPress={() => void reloadConfig()} accessibilityRole="button" hitSlop={8}>
            <Text variant="caption" color={colors.accent}>
              {t("common.retry")}
            </Text>
          </Pressable>
          <Pressable onPress={dismissConfigError} accessibilityRole="button" accessibilityLabel={t("common.dismiss")} hitSlop={8}>
            <Icon name="close" size={16} />
          </Pressable>
        </View>
      ) : null}

      {home.loading ? (
        <HomeSkeleton />
      ) : home.error && !home.data ? (
        <ErrorState message={home.error} onRetry={() => home.refetch({ silent: false })} retryLabel={t("common.retry")} />
      ) : (home.data?.rails.length ?? 0) === 0 ? (
        <EmptyState title={t("home.empty")} />
      ) : (
        <FlashList<HomeRail>
          data={rails.rest}
          keyExtractor={(r) => r.key}
          renderItem={({ item }) => <Rail title={item.title} items={item.items} />}
          ListHeaderComponent={
            <View>
              {rails.featured ? <FeaturedSlider items={rails.featured.items} /> : null}
              {rails.cont && rails.cont.items.length > 0 ? <ContinueRail title={rails.cont.title || t("home.continue_watching")} items={rails.cont.items} /> : null}
              {rails.forYou ? <Rail title={rails.forYou.title || t("home.for_you")} items={rails.forYou.items} /> : null}
            </View>
          }
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={home.refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
          showsVerticalScrollIndicator={false}
        />
      )}
    </Screen>
  );
}

/** The `continue` rail carries `progress` per card; open the player at that episode. */
function ContinueRail({ title, items }: { title: string; items: SeriesCardModel[] }) {
  const t = useT();
  const router = useRouter();
  return (
    <View>
      <SectionHeader title={title} />
      <FlashList
        horizontal
        data={items}
        keyExtractor={(s) => s.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: spacing.lg }}
        ItemSeparatorComponent={() => <View style={{ width: spacing.md }} />}
        renderItem={({ item }) => {
          const p = item.progress;
          const episodeNumber = p?.episode_number ?? 1;
          return (
            <SeriesCard
              series={item}
              width={CARD_WIDTH}
              subtitle={t("series.episode_n", { n: episodeNumber })}
              progress={p ? (p.duration_sec ? Math.min(1, p.position_sec / p.duration_sec) : 0) : undefined}
              onPress={() => router.push({ pathname: "/player/[seriesId]", params: { seriesId: item.id, episode: String(episodeNumber) } })}
            />
          );
        }}
      />
    </View>
  );
}

function HomeSkeleton() {
  return (
    <View style={{ paddingHorizontal: spacing.lg, gap: spacing.xl, marginTop: spacing.md }}>
      <Skeleton height={190} radius={radii.lg} />
      <View style={{ gap: spacing.sm }}>
        <Skeleton width={140} height={18} />
        <View style={{ flexDirection: "row", gap: spacing.md }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} width={CARD_WIDTH} height={Math.round((CARD_WIDTH * 16) / 9)} />
          ))}
        </View>
      </View>
      <View style={{ gap: spacing.sm }}>
        <Skeleton width={110} height={18} />
        <View style={{ flexDirection: "row", gap: spacing.md }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} width={CARD_WIDTH} height={Math.round((CARD_WIDTH * 16) / 9)} />
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  brand: { color: colors.accent },
  headerRight: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  coins: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  list: { paddingBottom: spacing.xxl },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.warning,
  },
});
