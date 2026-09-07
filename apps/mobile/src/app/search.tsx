import { colors, radii, spacing } from "@katha/tokens";
import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { Icon } from "@/components/icons";
import { SeriesCard } from "@/components/series-card";
import { EmptyState, ErrorState, Loading, Screen, Text, TextInput } from "@/components/ui";
import { useQuery } from "@/hooks/use-query";
import { useT } from "@/hooks/use-translations";
import { track } from "@/lib/analytics";
import { api } from "@/lib/api";
import { errorMessage, unwrap } from "@/lib/errors";
import { getJson, setJson } from "@/lib/storage";
import type { SeriesCard as SeriesCardModel } from "@/lib/types";
import { useConfig } from "@/providers/config";

const RECENT_MAX = 8;

export default function SearchScreen() {
  const t = useT();
  const router = useRouter();
  const { lang } = useConfig();
  const [q, setQ] = useState("");
  const [result, setResult] = useState<{ query: string; items: SeriesCardModel[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  // Genre chips come from the catalogue, so the empty state offers somewhere to go rather than an instruction.
  const categoriesQuery = useQuery(async () => unwrap(await api.GET("/v1/categories")), []);
  const categories = categoriesQuery.data ?? [];
  const { width: viewport } = useWindowDimensions();
  // Derived rather than a fixed 104px, which overflowed its gutters at 320dp and left dead space at 430dp.
  const cellWidth = Math.floor((viewport - spacing.md * 2 - spacing.sm * 6) / 3);
  const query = q.trim();
  const active = query.length >= 2;

  useEffect(() => {
    void getJson<string[]>("recentSearches").then((v) => setRecent(Array.isArray(v) ? v.slice(0, RECENT_MAX) : []));
  }, []);

  /** Remember a query once it has actually been run, so a half-typed term is never stored. */
  const remember = useCallback((term: string) => {
    setRecent((prev) => {
      const next = [term, ...prev.filter((x) => x.toLowerCase() !== term.toLowerCase())].slice(0, RECENT_MAX);
      void setJson("recentSearches", next);
      return next;
    });
  }, []);

  const clearRecent = useCallback(() => {
    setRecent([]);
    void setJson("recentSearches", []);
  }, []);

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
          remember(query);
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
    // `remember` is stable and deliberately not a dependency: including it would re-run the search when the
    // recent list changes, which is exactly what running the search causes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          // Pressing the keyboard's search key did nothing, and the keyboard stayed up over the results.
          onSubmitEditing={() => active && setAttempt((a) => a + 1)}
          style={{ flex: 1 }}
          accessibilityLabel={t("home.search")}
        />
        {q.length > 0 ? (
          // Clearing the query and dismissing the whole screen were the same 26px glyph, side by side.
          <Pressable onPress={() => setQ("")} accessibilityRole="button" accessibilityLabel={t("search.clear")} hitSlop={8}>
            <Icon name="close" size={18} color={colors.muted} />
          </Pressable>
        ) : null}
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t("common.cancel")} hitSlop={8}>
          <Text variant="label" color={colors.accent}>
            {t("common.cancel")}
          </Text>
        </Pressable>
      </View>
      {active && loading && !results ? (
        <Loading />
      ) : active && error && !results ? (
        <ErrorState message={error} onRetry={() => setAttempt((a) => a + 1)} retryLabel={t("common.retry")} />
      ) : results === null ? (
        <View style={styles.suggestions}>
          {recent.length > 0 ? (
            <>
              <View style={styles.suggestionHead}>
                <Text variant="label">{t("search.recent")}</Text>
                <Pressable onPress={clearRecent} accessibilityRole="button" hitSlop={8}>
                  <Text variant="caption" color={colors.accent}>
                    {t("search.clear_recent")}
                  </Text>
                </Pressable>
              </View>
              <View style={styles.chips}>
                {recent.map((term) => (
                  <Pressable key={term} onPress={() => setQ(term)} accessibilityRole="button" style={styles.chip}>
                    <Text variant="caption" color={colors.ink2}>
                      {term}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}

          {/* A viewer who does not know a title still needs somewhere to go. */}
          <Text variant="label" style={styles.suggestionHead}>
            {t("search.browse_genres")}
          </Text>
          <View style={styles.chips}>
            {categories.slice(0, 12).map((c) => (
              <Pressable key={c.id} onPress={() => setQ(c.name)} accessibilityRole="button" style={styles.chip}>
                <Text variant="caption" color={colors.ink2}>
                  {c.name}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : results.length === 0 ? (
        <EmptyState title={t("search.no_matches")} body={t("search.no_matches_body", { q: query })} />
      ) : (
        <FlashList
          data={results}
          numColumns={3}
          keyExtractor={(s) => s.id}
          renderItem={({ item }) => (
            <View style={styles.cell}>
              <SeriesCard series={item} width={cellWidth} />
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

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  grid: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl },
  cell: { padding: spacing.sm, alignItems: "center" },
  count: { paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, color: colors.muted },
  suggestions: { paddingHorizontal: spacing.lg, gap: spacing.md },
  suggestionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.md },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
});
