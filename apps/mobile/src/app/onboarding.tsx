import { colors, radii, spacing } from "@katha/tokens";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { Icon } from "@/components/icons";
import { Button, Screen, Skeleton, Text } from "@/components/ui";
import { useT } from "@/hooks/use-translations";
import { track } from "@/lib/analytics";
import { api } from "@/lib/api";
import { takeRoute } from "@/lib/pending-route";
import type { SeriesCard } from "@/lib/types";
import { useConfig } from "@/providers/config";

/**
 * Three pages, matching the reference: pick a language, then what the product is, then what the coins are for.
 *
 * The pager itself stays swipeable. The reference disables swiping on the screen that exists to teach
 * swiping, which is worth not copying.
 *
 * The last page keeps our own ending rather than the reference's static card: three real covers in the
 * language just chosen, and a button into the first episode. Same position in the flow, same "get started"
 * role, but it ends inside the catalogue instead of on another illustration.
 */
type Page = { key: string };
const PAGES: Page[] = [{ key: "language" }, { key: "discover" }, { key: "start" }];

export default function OnboardingScreen() {
  const t = useT();
  const router = useRouter();
  const { config, lang, setLang, completeOnboarding } = useConfig();
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState(lang);
  const selectedName = config.languages.find((l) => l.code === selected)?.native_name ?? selected.toUpperCase();
  const listRef = useRef<FlatList<Page>>(null);

  /** Real covers in the language just chosen. Null while loading, empty when the catalogue has nothing yet. */
  const [picks, setPicks] = useState<SeriesCard[] | null>(null);

  useEffect(() => {
    // The funnel this screen sits at the top of was unmeasurable: the event existed in the client's union and
    // nothing ever emitted it.
    track("onboarding_start", { lang });
  }, [lang]);

  const goTo = useCallback((i: number) => {
    listRef.current?.scrollToIndex({ index: i, animated: true });
    setPage(i);
  }, []);

  /** Fetched once the language is settled, so the covers are the ones this viewer will actually browse. */
  const loadPicks = useCallback(
    async (code: string) => {
      setPicks(null);
      try {
        const { data } = await api.GET("/v1/home", { params: { query: { lang: code } } });
        const rails = data?.rails ?? [];
        const rail = rails.find((r) => r.key === "featured" && r.items.length > 0) ?? rails.find((r) => r.items.length > 0);
        setPicks((rail?.items ?? []).slice(0, 3));
      } catch {
        // No network on first launch is common here; the screen falls back to its own copy and a plain CTA.
        setPicks([]);
      }
    },
    [],
  );

  /**
   * Land where the viewer was actually headed. A deep link that arrived before onboarding was parked rather
   * than discarded, so someone who tapped a friend's link finally sees the series they were sent.
   */
  const resume = useCallback(
    async (fallback?: () => void) => {
      const pending = await takeRoute();
      if (pending) {
        track("deep_link_open", { resolved: true, resumed: true, pathname: pending.pathname });
        router.replace({ pathname: pending.pathname as never, params: pending.params as never });
        return;
      }
      if (fallback) {
        fallback();
        return;
      }
      router.replace("/(tabs)");
    },
    [router],
  );

  const finish = useCallback(
    async (fallback?: () => void) => {
      await completeOnboarding();
      track("onboarding_complete", { lang: selected, seeded: (picks?.length ?? 0) > 0 });
      await resume(fallback);
    },
    [completeOnboarding, resume, selected, picks],
  );

  const skip = useCallback(async () => {
    await setLang(selected);
    await finish();
  }, [selected, setLang, finish]);

  const next = useCallback(async () => {
    if (page === 0) {
      await setLang(selected);
      // Fetched now rather than on the last page, so the covers are already there when it arrives.
      void loadPicks(selected);
      goTo(1);
      return;
    }
    if (page < PAGES.length - 1) {
      goTo(page + 1);
      return;
    }
    // Straight into the first episode of the first pick: the fastest honest path from install to a frame.
    const first = picks?.[0];
    await finish(
      first
        ? () => router.replace({ pathname: "/player/[seriesId]", params: { seriesId: first.id, episode: "1" } })
        : undefined,
    );
  }, [page, selected, setLang, loadPicks, goTo, picks, finish, router]);

  const firstPick = picks?.[0];

  return (
    <Screen edges={["top", "bottom", "left", "right"]}>
      <FlatList
        ref={listRef}
        data={PAGES}
        horizontal
        pagingEnabled
        // Swiping is the product's core gesture. Disabling it on the screen that introduces the product taught
        // the opposite of the intended lesson.
        showsHorizontalScrollIndicator={false}
        keyExtractor={(p) => p.key}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        onMomentumScrollEnd={(e) => {
          const i = Math.round(e.nativeEvent.contentOffset.x / width);
          if (i === page) return;
          setPage(i);
          if (i === 1 && picks === null) void loadPicks(selected);
        }}
        renderItem={({ item }) => (
          <View style={{ width, flex: 1, paddingHorizontal: spacing.xl }}>
            {item.key === "language" ? (
              <View style={styles.page}>
                <Text variant="display">{t("onboarding.language")}</Text>
                <Text variant="body">{t("onboarding.language_help")}</Text>
                <View style={styles.langGrid}>
                  {config.languages.map((l) => {
                    const active = l.code === selected;
                    return (
                      <Pressable
                        key={l.code}
                        onPress={() => setSelected(l.code)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: active }}
                        style={[styles.langChip, active && styles.langChipActive]}
                      >
                        <Text variant="label" color={active ? colors.accentInk : colors.ink}>
                          {l.native_name ?? l.name}
                        </Text>
                        {l.native_name && l.native_name !== l.name ? (
                          <Text variant="caption" color={active ? colors.accentInk : colors.muted}>
                            {l.name}
                          </Text>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : item.key === "discover" ? (
              <View style={styles.page}>
                <View style={styles.hero}>
                  <Icon name="shorts" size={56} color={colors.accent} />
                </View>
                <Text variant="display">{t("onboarding.discover_title")}</Text>
                <Text variant="body">{t("onboarding.discover_body")}</Text>
              </View>
            ) : (
              <View style={styles.page}>
                <View style={styles.posters}>
                  {picks === null
                    ? [0, 1, 2].map((i) => <Skeleton key={i} width={92} height={164} radius={radii.md} />)
                    : picks.length > 0
                      ? picks.map((s, i) => (
                          <Image
                            key={s.id}
                            source={s.cover_url}
                            style={[styles.poster, i === 0 && styles.posterLead]}
                            contentFit="cover"
                            transition={200}
                          />
                        ))
                      : (
                          <View style={styles.hero}>
                            <Icon name="shorts" size={48} color={colors.accent} />
                          </View>
                        )}
                </View>
                <Text variant="display">{firstPick ? firstPick.title : t("onboarding.feed_title")}</Text>
                <Text variant="body">{firstPick ? t("onboarding.start_body") : t("onboarding.feed_body")}</Text>
              </View>
            )}
          </View>
        )}
      />
      <View style={styles.footer}>
        <View style={styles.dots}>
          {PAGES.map((p, i) => (
            <View key={p.key} style={[styles.dot, i === page && styles.dotActive]} />
          ))}
        </View>
        <Button
          title={
            page === 0
              ? // Naming the language on the button confirms the choice in the language just chosen.
                t("onboarding.continue_in", { lang: selectedName })
              : page === 1
                ? t("onboarding.next")
                : firstPick
                  ? t("onboarding.watch_now")
                  : t("onboarding.start")
          }
          onPress={next}
          left={page === PAGES.length - 1 && firstPick ? <Icon name="play" size={14} color={colors.accentInk} /> : undefined}
        />
        <Pressable onPress={skip} accessibilityRole="button" style={styles.skip} hitSlop={12}>
          <Text variant="label" color={colors.muted}>
            {page === PAGES.length - 1 && firstPick ? t("onboarding.browse_instead") : t("onboarding.skip")}
          </Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, justifyContent: "center", gap: spacing.lg },
  posters: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, marginBottom: spacing.sm },
  poster: {
    width: 92,
    height: 164,
    borderRadius: radii.md,
    backgroundColor: colors.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  // The one the button will open reads as the subject, not as one of three.
  posterLead: { width: 116, height: 206 },
  hero: {
    width: 96,
    height: 96,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
  },
  langGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  langChip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    minWidth: 120,
  },
  langChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  footer: { paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, gap: spacing.md },
  skip: { alignSelf: "center", paddingVertical: spacing.sm },
  dots: { flexDirection: "row", justifyContent: "center", gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.line },
  dotActive: { backgroundColor: colors.accent, width: 18 },
});
