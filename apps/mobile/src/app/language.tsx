import { colors, spacing } from "@katha/tokens";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Icon } from "@/components/icons";
import { Card, Divider, ListRow, Screen, Text } from "@/components/ui";
import { useT } from "@/hooks/use-translations";
import { api } from "@/lib/api";
import { applyLayoutDirection } from "@/lib/layout-direction";
import { useAuth } from "@/providers/auth";
import { useConfig } from "@/providers/config";

export default function LanguageScreen() {
  const t = useT();
  const router = useRouter();
  const { config, lang, setLang } = useConfig();
  const { status } = useAuth();
  const [saving, setSaving] = useState<string | null>(null);

  const choose = useCallback(
    async (code: string) => {
      setSaving(code);
      await setLang(code);
      if (status === "signed_in") {
        // Locale on the profile drives server-side defaults; failure is not user-facing.
        await api.PATCH("/v1/auth/me", { body: { locale: code } }).catch(() => {});
      }
      setSaving(null);
      // Writing direction is fixed for the life of the process: React Native reads it once at startup. The
      // preference is recorded now and the viewer is told, in the language they just chose, that a restart
      // finishes the job. (expo-updates is not in this build, so there is no reload to offer.)
      const chosen = config.languages.find((l) => l.code === code);
      const changed = applyLayoutDirection(Boolean(chosen?.rtl));
      if (changed) {
        // The catalogue for the new language may not have arrived yet; the strings fall back to English.
        Alert.alert(t("language.restart_title"), t("language.restart_body"), [{ text: t("common.done") }]);
      }
      if (router.canGoBack()) router.back();
    },
    [setLang, status, router, config.languages, t],
  );

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/me"))} accessibilityRole="button" accessibilityLabel={t("common.back")} hitSlop={10}>
          <Icon name="back" size={30} />
        </Pressable>
        <Text variant="title">{t("me.language")}</Text>
        <View style={{ width: 30 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Card style={{ padding: 0 }}>
          {config.languages.map((l, i) => (
            <View key={l.code}>
              {i > 0 ? <Divider /> : null}
              <ListRow
                title={l.native_name ?? l.name}
                subtitle={l.native_name && l.native_name !== l.name ? l.name : undefined}
                onPress={() => choose(l.code)}
                disabled={saving !== null}
                right={l.code === lang ? <Icon name="check" size={18} color={colors.accent} /> : <View style={{ width: 22 }} />}
              />
            </View>
          ))}
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  content: { padding: spacing.lg },
});
