import { colors, radii, spacing } from "@katha/tokens";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Icon } from "@/components/icons";
import { Button, Card, Divider, ListRow, Pill, Screen, Text, Toast } from "@/components/ui";
import { useT } from "@/hooks/use-translations";
import { api } from "@/lib/api";
import { pickAndUploadAvatar } from "@/lib/avatar";
import { getAppVersion } from "@/lib/device";
import { errorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { clearCaches } from "@/lib/storage";
import { useAuth } from "@/providers/auth";
import { useConfig } from "@/providers/config";

export default function MeScreen() {
  const t = useT();
  const router = useRouter();
  const { config, lang, reloadConfig } = useConfig();
  const { status, user, balance, signOut, refreshUser, requireAuth, applyUser } = useAuth();
  const [busy, setBusy] = useState<"signout" | "delete" | "avatar" | "cache" | null>(null);
  const [notice, setNotice] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const signedIn = status === "signed_in";
  const language = config.languages.find((l) => l.code === lang);

  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      if (signedIn) refreshUser().catch(() => {});
    }, [signedIn, refreshUser]),
  );

  const openUrl = useCallback(
    (url: string | null | undefined, fallbackSlug: string) => {
      if (url) {
        WebBrowser.openBrowserAsync(url, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET }).catch(() => {});
      } else {
        router.push({ pathname: "/page/[slug]", params: { slug: fallbackSlug } });
      }
    },
    [router],
  );

  const onSignOut = useCallback(async () => {
    setBusy("signout");
    try {
      await signOut();
    } finally {
      setBusy(null);
    }
  }, [signOut]);

  const changeAvatar = useCallback(async () => {
    if (!requireAuth()) return;
    setBusy("avatar");
    setNotice(null);
    try {
      const result = await pickAndUploadAvatar();
      if (result.status === "done") {
        applyUser(result.user);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }
    } catch (e) {
      setNotice({ tone: "error", text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }, [requireAuth, applyUser]);

  /**
   * Cache reset, not a sign-out: drops the stored config and translation bundles and the image cache, then
   * re-fetches the config so the UI stays populated. expo-video (SDK 57) exposes no cache API, so the HLS
   * segments the native player buffered are left to the OS.
   */
  const clearCache = useCallback(async () => {
    setBusy("cache");
    setNotice(null);
    try {
      await clearCaches();
      await Promise.all([Image.clearMemoryCache(), Image.clearDiskCache()]);
      await reloadConfig();
      setToast("Cache cleared");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch {
      setToast("Could not clear the cache");
    } finally {
      setBusy(null);
    }
  }, [reloadConfig]);

  const deleteAccount = useCallback(() => {
    Alert.alert(
      t("me.delete_account"),
      "This permanently deletes your account, coins, purchases and history. This cannot be undone.",
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setBusy("delete");
            setNotice(null);
            try {
              const { response } = await api.DELETE("/v1/auth/me");
              if (!response.ok) throw new Error(response.status === 401 ? "Please sign in again first." : "Could not delete the account.");
              await signOut();
            } catch (e) {
              setNotice({ tone: "error", text: errorMessage(e) });
            } finally {
              setBusy(null);
            }
          },
        },
      ],
      { cancelable: true },
    );
  }, [signOut, t]);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.profile}>
          <Pressable
            onPress={signedIn ? changeAvatar : undefined}
            disabled={!signedIn || busy !== null}
            accessibilityRole={signedIn ? "button" : undefined}
            accessibilityLabel="Change profile picture"
            style={styles.avatar}
          >
            {user?.avatar_url ? <Image source={user.avatar_url} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Icon name="me" size={28} color={colors.muted} />}
            {signedIn ? (
              <View style={styles.avatarBadge}>
                <Text variant="caption" color={colors.accentInk} style={{ fontSize: 10, lineHeight: 12 }}>
                  {busy === "avatar" ? "…" : "Edit"}
                </Text>
              </View>
            ) : null}
          </Pressable>
          <View style={{ flex: 1, gap: 2 }}>
            {signedIn && user ? (
              <>
                <Text variant="title" numberOfLines={1}>
                  {user.display_name ?? user.email ?? "Katha viewer"}
                </Text>
                <Text variant="caption">ID {user.public_id}</Text>
                {user.is_vip ? <Pill label={user.vip_ends_at ? `VIP until ${formatDate(user.vip_ends_at)}` : "VIP"} tone="gold" style={{ marginTop: 4 }} /> : null}
              </>
            ) : (
              <>
                <Text variant="title">Guest</Text>
                <Text variant="caption">{t("me.guest_title")}</Text>
              </>
            )}
          </View>
        </View>

        {notice ? (
          <Text variant="caption" color={notice.tone === "error" ? colors.danger : colors.ink2}>
            {notice.text}
          </Text>
        ) : null}

        {!signedIn ? <Button title={t("common.sign_in")} onPress={() => requireAuth()} disabled={status === "loading"} /> : null}

        <Card style={styles.walletCard}>
          <View style={{ flex: 1 }}>
            <Text variant="caption">{t("me.coins")}</Text>
            <View style={styles.coinRow}>
              <Icon name="coin" size={18} />
              <Text variant="display">{signedIn ? balance : "—"}</Text>
            </View>
          </View>
          <Button
            title={t("wallet.top_up")}
            variant="gold"
            small
            onPress={() => {
              if (requireAuth()) router.push("/wallet");
            }}
          />
        </Card>

        <Card style={{ padding: 0 }}>
          <ListRow
            title={t("rewards.title")}
            subtitle="Daily check-in and tasks"
            onPress={() => {
              if (requireAuth()) router.push("/rewards");
            }}
            right={<Icon name="gift" size={18} />}
          />
          <Divider />
          <ListRow
            title={t("wallet.ledger")}
            subtitle="Coins earned and spent"
            onPress={() => {
              if (requireAuth()) router.push("/wallet/ledger");
            }}
          />
          <Divider />
          <ListRow title={t("list.history")} subtitle="Continue where you left off" onPress={() => router.push("/(tabs)/list")} />
        </Card>

        <Text variant="caption" style={styles.sectionLabel}>
          {t("me.settings")}
        </Text>
        <Card style={{ padding: 0 }}>
          <ListRow title={t("me.language")} subtitle={language ? (language.native_name ?? language.name) : lang} onPress={() => router.push("/language")} />
          <Divider />
          <ListRow
            title={busy === "cache" ? "Clearing…" : t("me.clear_cache")}
            subtitle="Frees space used by saved settings, translations and images"
            onPress={() => void clearCache()}
            disabled={busy !== null}
          />
          <Divider />
          <ListRow title={t("me.privacy")} onPress={() => openUrl(config.mobile.privacy_policy_url, "privacy")} />
          <Divider />
          <ListRow title={t("me.terms")} onPress={() => openUrl(config.mobile.terms_url, "terms")} />
          {config.mobile.rate_us_url ? (
            <>
              <Divider />
              <ListRow title="Rate Katha" onPress={() => openUrl(config.mobile.rate_us_url, "rate")} />
            </>
          ) : null}
        </Card>

        {signedIn ? (
          <Card style={{ padding: 0 }}>
            <ListRow
              title={busy === "delete" ? "Deleting…" : t("me.delete_account")}
              subtitle="Removes your profile, coins and history"
              onPress={deleteAccount}
              disabled={busy !== null}
              destructive
            />
            <Divider />
            <Pressable onPress={onSignOut} disabled={busy !== null} accessibilityRole="button" style={({ pressed }) => [styles.signOut, pressed && { opacity: 0.7 }]}>
              <Text variant="label" color={colors.danger}>
                {busy === "signout" ? "Signing out…" : t("me.sign_out")}
              </Text>
            </Pressable>
          </Card>
        ) : null}

        <Text variant="caption" style={styles.version}>
          Katha {getAppVersion()}
        </Text>
      </ScrollView>
      <Toast message={toast} onHide={() => setToast(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  profile: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarBadge: { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: colors.accent, alignItems: "center", paddingVertical: 1 },
  walletCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderColor: colors.gold, borderRadius: radii.lg },
  coinRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  sectionLabel: { marginTop: spacing.sm, marginBottom: -spacing.sm, textTransform: "uppercase", letterSpacing: 1 },
  signOut: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 52, justifyContent: "center" },
  version: { textAlign: "center" },
});
