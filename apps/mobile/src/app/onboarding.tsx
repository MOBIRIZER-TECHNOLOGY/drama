import { colors, radii, spacing } from "@katha/tokens";
import { useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { Icon } from "@/components/icons";
import { Button, Screen, Text } from "@/components/ui";
import { useT } from "@/hooks/use-translations";
import { useConfig } from "@/providers/config";

type Page = { key: string };
const PAGES: Page[] = [{ key: "language" }, { key: "feed" }, { key: "coins" }];

export default function OnboardingScreen() {
  const t = useT();
  const router = useRouter();
  const { config, lang, setLang, completeOnboarding } = useConfig();
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState(lang);
  const selectedName = config.languages.find((l) => l.code === selected)?.native_name ?? selected.toUpperCase();
  const listRef = useRef<FlatList<Page>>(null);

  const goTo = useCallback((i: number) => {
    listRef.current?.scrollToIndex({ index: i, animated: true });
    setPage(i);
  }, []);

  const skip = useCallback(async () => {
    await setLang(selected);
    await completeOnboarding();
    router.replace("/(tabs)");
  }, [selected, setLang, completeOnboarding, router]);

  const next = useCallback(async () => {
    if (page === 0) await setLang(selected);
    if (page < PAGES.length - 1) {
      goTo(page + 1);
      return;
    }
    await completeOnboarding();
    router.replace("/(tabs)");
  }, [page, selected, setLang, goTo, completeOnboarding, router]);

  return (
    <Screen edges={["top", "bottom", "left", "right"]}>
      <FlatList
        ref={listRef}
        data={PAGES}
        horizontal
        pagingEnabled
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        keyExtractor={(p) => p.key}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
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
            ) : item.key === "feed" ? (
              <View style={styles.page}>
                <View style={styles.hero}>
                  <Icon name="shorts" size={48} color={colors.accent} />
                </View>
                <Text variant="display">{t("onboarding.feed_title")}</Text>
                <Text variant="body">{t("onboarding.feed_body")}</Text>
              </View>
            ) : (
              <View style={styles.page}>
                <View style={styles.hero}>
                  <Icon name="coin" size={48} />
                </View>
                <Text variant="display">{t("onboarding.coins_title")}</Text>
                <Text variant="body">{t("onboarding.coins_body")}</Text>
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
            page === PAGES.length - 1
              ? t("onboarding.start")
              : page === 0
                ? // Naming the language on the button confirms the choice in the language just chosen.
                  t("onboarding.continue_in", { lang: selectedName })
                : t("onboarding.continue")
          }
          onPress={next}
        />
        <Pressable onPress={skip} accessibilityRole="button" style={styles.skip} hitSlop={12}>
          <Text variant="label" color={colors.muted}>
            {t("onboarding.skip")}
          </Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, justifyContent: "center", gap: spacing.lg },
  hero: {
    width: 96,
    height: 96,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
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
