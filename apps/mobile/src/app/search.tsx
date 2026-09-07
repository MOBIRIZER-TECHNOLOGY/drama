import { colors, spacing } from "@katha/tokens";
import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Icon } from "@/components/icons";
import { SeriesCard } from "@/components/series-card";
import { EmptyState, ErrorState, Loading, Screen, Text, TextInput } from "@/components/ui";
import { useT } from "@/hooks/use-translations";
import { track } from "@/lib/analytics";
import { api } from "@/lib/api";
import { errorMessage, unwrap } from "@/lib/errors";
import type { SeriesCard as SeriesCardModel } from "@/lib/types";
import { useConfig } from "@/providers/config";

export default function SearchScreen() {
  const t = useT();
  const router = useRouter();
  const { lang } = useConfig();
  const [q, setQ] = useState("");
  const [result, setResult] = useState<{ query: string; items: SeriesCardModel[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const query = q.trim();
  const active = query.length >= 2;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const data = unwrap(await api.GET("/v1/series", { params: { query: { lang, q: query, limit: 40 } } }));
        if (!cancelled) {
          setResult({ query, items: data });
          setError(null);
          track("search", { query, results: data.length, lang });
        }
      } catch (e) {
        if (!cancelled) setError(errorMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, query, lang, attempt]);

  // Only show results that belong to the current query; anything else is stale.
  const results = active && result?.query === query ? result.items : null;

  return (
    <Screen edges={["top", "bottom", "left", "right"]}>
      <View style={styles.bar}>
        <TextInput
          autoFocus
          placeholder={t("home.search")}
          value={q}
          onChangeText={setQ}
          returnKeyType="search"
          autoCorrect={false}
          style={{ flex: 1 }}
          accessibilityLabel={t("home.search")}
        />
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t("common.cancel")} hitSlop={8}>
          <Icon name="close" size={26} />
        </Pressable>
      </View>
      {active && loading && !results ? (
        <Loading />
      ) : active && error && !results ? (
        <ErrorState message={error} onRetry={() => setAttempt((a) => a + 1)} retryLabel={t("common.retry")} />
      ) : results === null ? (
        <EmptyState title="Find a series" body="Search by title. Try a genre or a name." />
      ) : results.length === 0 ? (
        <EmptyState title="No matches" body={`Nothing found for “${query}”.`} />
      ) : (
        <FlashList
          data={results}
          numColumns={3}
          keyExtractor={(s) => s.id}
          renderItem={({ item }) => (
            <View style={styles.cell}>
              <SeriesCard series={item} width={CELL_WIDTH} />
            </View>
          )}
          contentContainerStyle={styles.grid}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <Text variant="caption" style={styles.count}>
              {results.length} result{results.length === 1 ? "" : "s"}
            </Text>
          }
        />
      )}
    </Screen>
  );
}

const CELL_WIDTH = 104;

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  grid: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl },
  cell: { padding: spacing.sm, alignItems: "center" },
  count: { paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, color: colors.muted },
});
