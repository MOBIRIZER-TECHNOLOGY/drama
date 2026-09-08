import { spacing } from "@katha/tokens";
import { FlashList } from "@shopify/flash-list";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { Icon } from "@/components/icons";
import { SeriesCard } from "@/components/series-card";
import { EmptyState, ErrorState, Loading, Screen, Text } from "@/components/ui";
import { useQuery } from "@/hooks/use-query";
import { useT } from "@/hooks/use-translations";
import { api } from "@/lib/api";
import { unwrap } from "@/lib/errors";
import { useConfig } from "@/providers/config";

/**
 * Everything in one home rail, as a grid.
 *
 * A rail shows four or five titles and scrolls sideways; past that the catalogue is invisible. The reference
 * gives every section a "view all" that opens the full list, which is the only way a viewer sees that a genre
 * has thirty titles rather than the five that fit on screen.
 *
 * The rail is re-read from `/v1/home` by key rather than handed over in navigation params: the same request
 * the home screen already made, so the two cannot show different contents, and a cold start on a deep link
 * still works.
 */
export default function RailScreen() {
  const t = useT();
  const router = useRouter();
  const { lang } = useConfig();
  const { key, title } = useLocalSearchParams<{ key: string; title?: string }>();
  const { width: viewport } = useWindowDimensions();
  const cellWidth = Math.floor((viewport - spacing.md * 2 - spacing.sm * 6) / 3);

  const home = useQuery(async () => unwrap(await api.GET("/v1/home", { params: { query: { lang } } })), [lang]);
  const rail = home.data?.rails.find((r) => r.key === key) ?? null;

  return (
    <Screen edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)"))}
          accessibilityRole="button"
          accessibilityLabel={t("common.back")}
          hitSlop={10}
        >
          <Icon name="back" size={30} />
        </Pressable>
        <Text variant="title">{title || rail?.title || ""}</Text>
        {/* Balances the back control so the title stays centred. */}
        <View style={{ width: 30 }} />
      </View>
      {home.loading ? (
        <Loading />
      ) : home.error ? (
        <ErrorState message={home.error} onRetry={() => home.refetch({ silent: false })} retryLabel={t("common.retry")} />
      ) : !rail || rail.items.length === 0 ? (
        <EmptyState title={t("home.empty")} />
      ) : (
        <FlashList
          data={rail.items}
          numColumns={3}
          keyExtractor={(s) => s.id}
          renderItem={({ item }) => (
            <View style={styles.cell}>
              <SeriesCard series={item} width={cellWidth} />
            </View>
          )}
          contentContainerStyle={styles.grid}
          showsVerticalScrollIndicator={false}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  grid: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl },
  cell: { padding: spacing.sm },
});
