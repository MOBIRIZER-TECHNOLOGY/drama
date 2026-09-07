import { colors, spacing } from "@katha/tokens";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Icon } from "@/components/icons";
import { Card, Divider, ListRow, Screen, Text } from "@/components/ui";
import { useT } from "@/hooks/use-translations";
import { api } from "@/lib/api";
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
      if (router.canGoBack()) router.back();
    },
    [setLang, status, router],
  );

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/me"))} accessibilityRole="button" accessibilityLabel="Back" hitSlop={10}>
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
