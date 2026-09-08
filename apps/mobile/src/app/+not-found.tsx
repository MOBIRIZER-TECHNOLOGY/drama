import { colors, spacing } from "@katha/tokens";
import { useGlobalSearchParams, usePathname, useRouter } from "expo-router";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { Icon } from "@/components/icons";
import { Button, Screen, Text } from "@/components/ui";
import { useT } from "@/hooks/use-translations";
import { track } from "@/lib/analytics";

/**
 * A link that went nowhere.
 *
 * This used to be six lines that silently `<Redirect href="/(tabs)" />`. Two things were wrong with that: the
 * viewer tapped a specific drama and arrived somewhere they did not ask for with no explanation, and the
 * campaign that paid for the tap was never told the link failed — the parameters went straight into the void,
 * so a broken creative could run for a week looking fine.
 *
 * Now it says what happened, reports the dead path with whatever attribution came attached, and offers the two
 * ways forward that actually recover someone: search for what they were sent, or start browsing.
 */
export default function NotFoundScreen() {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const params = useGlobalSearchParams<Record<string, string>>();

  useEffect(() => {
    // Campaign parameters are the point of reporting this: `?utm_source=…` on a dead link is a broken creative,
    // and it is invisible unless the failure carries them.
    const campaign: Record<string, string> = {};
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "string" && /^(utm_|ref$|campaign$)/.test(key)) campaign[key] = value;
    }
    track("deep_link_open", { resolved: false, pathname, ...campaign });
  }, [pathname, params]);

  return (
    <Screen>
      <View style={styles.body}>
        <Icon name="search" size={40} color={colors.muted} />
        <Text variant="title" style={styles.centred}>
          {t("not_found.title")}
        </Text>
        <Text variant="body" style={styles.centred}>
          {t("not_found.message")}
        </Text>
        {/* Support asks "what link did you tap?" and nobody can answer it from memory. */}
        {pathname ? (
          <Text variant="caption" style={styles.path} numberOfLines={2}>
            {pathname}
          </Text>
        ) : null}
        <View style={styles.actions}>
          <Button title={t("not_found.search")} onPress={() => router.replace("/search")} left={<Icon name="search" size={14} color={colors.accentInk} />} />
          <Button title={t("not_found.browse")} variant="secondary" onPress={() => router.replace("/(tabs)")} />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, paddingHorizontal: spacing.xl },
  centred: { textAlign: "center" },
  path: { color: colors.muted, textAlign: "center" },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
});
