import { colors, radii, spacing } from "@katha/tokens";
import { FlashList } from "@shopify/flash-list";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { Icon } from "@/components/icons";
import { SeriesCard } from "@/components/series-card";
import { Button, EmptyState, ErrorState, Screen, SkeletonRows, Text, TextInput } from "@/components/ui";
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
  // Opened from a genre chip on home, the screen arrives with its genre already chosen rather than empty.
  const { q: initialQuery, category: initialCategory } = useLocalSearchParams<{ q?: string; category?: string }>();
  const [q, setQ] = useState(initialQuery ?? "");
  /**
   * A genre is a filter, not a search term. The chips used to put the genre's name into the search box, and
   * the catalogue search matches titles and synopses, so "Romance" found nothing on a catalogue full of
   * romance. The slug goes to the API as the same `category` filter the web app sends.
   */
  const [category, setCategory] = useState<{ slug: string; name: string } | null>(
    initialCategory ? { slug: initialCategory, name: initialCategory } : null,
  );
  const [result, setResult] = useState<{ query: string; items: SeriesCardModel[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  /**
   * Narrowing a result set.
   *
   * The grid was all-or-nothing: forty titles in no particular shape, and the only way to narrow them was a
   * better query. "Is it finished" and "how long is it" are the two questions this audience asks of a
   * short-drama catalogue, and neither could be asked. Filtering happens server-side so the whole catalogue
   * is searched, not the forty rows that happened to load.
   */
  const [status, setStatus] = useState<"completed" | "ongoing" | null>(null);
  const [length, setLength] = useState<"short" | "medium" | "long" | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  // Genre chips come from the catalogue, so the empty state offers somewhere to go rather than an instruction.
  const categoriesQuery = useQuery(async () => unwrap(await api.GET("/v1/categories", { params: { query: { lang } } })), [lang]);
  const categories = categoriesQuery.data ?? [];
  const { width: viewport } = useWindowDimensions();
  // Derived rather than a fixed 104px, which overflowed its gutters at 320dp and left dead space at 430dp.
  const cellWidth = Math.floor((viewport - spacing.md * 2 - spacing.sm * 6) / 3);
  const query = q.trim();
  const active = query.length >= 2 || category !== null;
  // What a result set answers to: the term, the genre, or both.
  const resultKey = `${query}|${category?.slug ?? ""}`;

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
        const data = unwrap(
          await api.GET("/v1/series", {
            params: {
              query: {
                lang,
                q: query || undefined,
                category: category?.slug,
                limit: 40,
                status: status ?? undefined,
                length: length ?? undefined,
              },
            },
          }),
        );
        if (!cancelled) {
          setResult({ query: resultKey, items: data });
          setError(null);
          track("search", { query, category: category?.slug ?? null, results: data.length, lang });
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
  }, [active, query, resultKey, category, lang, attempt, status, length]);

  // Remembered only on an act of intent — the search key, a chip, a result — never on the debounced fetch,
  // which otherwise filled the list with every prefix typed on the way to the term the viewer meant.
  const submit = useCallback(() => {
    if (!active) return;
    remember(query);
    setAttempt((a) => a + 1);
  }, [active, query, remember]);

  const pickTerm = useCallback(
    (term: string) => {
      setQ(term);
      remember(term);
    },
    [remember],
  );

  // Only show results that belong to the current query and genre; anything else is stale.
  const results = active && result?.query === resultKey ? result.items : null;
  const narrowed = status !== null || length !== null;
  // Once a genre is chosen its name is the chip that clears it; the catalogue's name replaces the slug the
  // route arrived with as soon as the categories load.
  const activeCategory = category && (categories.find((c) => c.slug === category.slug) ?? category);

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
          onSubmitEditing={submit}
          style={{ flex: 1 }}
          accessibilityLabel={t("home.search")}
        />
        {q.length > 0 ? (
          // Clearing the query and dismissing the whole screen were the same 26px glyph, side by side.
          <Pressable
            onPress={() => {
              setQ("");
              setCategory(null);
            }}
            accessibilityRole="button"
            accessibilityLabel={t("search.clear")}
            hitSlop={8}
          >
            <Icon name="close" size={18} color={colors.muted} />
          </Pressable>
        ) : null}
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t("common.cancel")} hitSlop={8}>
          <Text variant="label" color={colors.accent}>
            {t("common.cancel")}
          </Text>
        </Pressable>
      </View>
      {active ? (
        <View style={styles.facets}>
          {activeCategory ? (
            <Pressable
              onPress={() => setCategory(null)}
              accessibilityRole="button"
              accessibilityState={{ selected: true }}
              accessibilityLabel={`${activeCategory.name}, ${t("common.clear")}`}
              style={[styles.facet, styles.facetOn]}
            >
              <Text variant="caption" color={colors.accentInk}>
                {activeCategory.name} ×
              </Text>
            </Pressable>
          ) : null}
          {([
            ["completed", () => setStatus((v) => (v === "completed" ? null : "completed")), status === "completed"],
            ["ongoing", () => setStatus((v) => (v === "ongoing" ? null : "ongoing")), status === "ongoing"],
            ["short", () => setLength((v) => (v === "short" ? null : "short")), length === "short"],
            ["medium", () => setLength((v) => (v === "medium" ? null : "medium")), length === "medium"],
            ["long", () => setLength((v) => (v === "long" ? null : "long")), length === "long"],
          ] as const).map(([key, toggle, on]) => (
            <Pressable
              key={key}
              onPress={toggle}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={[styles.facet, on && styles.facetOn]}
            >
              <Text variant="caption" color={on ? colors.accentInk : colors.ink2}>
                {t(`search.${key}` as "search.completed")}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {active && loading && !results ? (
        <SkeletonRows count={6} height={72} />
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
                  <Pressable key={term} onPress={() => pickTerm(term)} accessibilityRole="button" style={styles.chip}>
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
              <Pressable key={c.id} onPress={() => setCategory({ slug: c.slug, name: c.name })} accessibilityRole="button" style={styles.chip}>
                <Text variant="caption" color={colors.ink2}>
                  {c.name}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : results.length === 0 ? (
        <EmptyState
          title={t("search.no_matches")}
          // Two different dead ends. Telling someone to try a different term when the problem is a filter they
          // set themselves sends them the wrong way.
          body={narrowed ? t("search.no_results_filtered") : t("search.no_matches_body", { q: query || activeCategory?.name || "" })}
          action={
            narrowed ? (
              <Button
                title={t("search.clear_filters")}
                variant="secondary"
                small
                onPress={() => {
                  setStatus(null);
                  setLength(null);
                }}
              />
            ) : undefined
          }
        />
      ) : (
        <FlashList
          data={results}
          numColumns={3}
          keyExtractor={(s) => s.id}
          renderItem={({ item }) => (
            <View style={styles.cell}>
              <SeriesCard
                series={item}
                width={cellWidth}
                onPress={() => {
                  remember(query);
                  router.push({ pathname: "/series/[id]", params: { id: item.id } });
                }}
              />
            </View>
          )}
          contentContainerStyle={styles.grid}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <Text variant="caption" style={styles.count}>
              {results.length === 1 ? t("search.results_one") : t("search.results_n", { n: results.length })}
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
  facets: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  facet: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  facetOn: { backgroundColor: colors.accent, borderColor: colors.accent },
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
