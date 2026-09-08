import { colors, radii, spacing } from "@katha/tokens";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Icon } from "@/components/icons";
import { NotificationSettings } from "@/components/notification-settings";
import { Button, Card, Divider, ListRow, Pill, Screen, Skeleton, Text, Toast } from "@/components/ui";
import { useQuery } from "@/hooks/use-query";
import { useLegalLinks } from "@/hooks/use-legal-links";
import { useT } from "@/hooks/use-translations";
import { api } from "@/lib/api";
import { unwrap , errorMessage } from "@/lib/errors";
import { pickAndUploadAvatar } from "@/lib/avatar";
import { getAppVersion } from "@/lib/device";
import { formatDate } from "@/lib/format";
import { clearCaches } from "@/lib/storage";
import { useAuth } from "@/providers/auth";
import { useConfig } from "@/providers/config";

export default function MeScreen() {
  const t = useT();
  const { openPrivacy, openTerms, openRateUs } = useLegalLinks();
  const router = useRouter();
  const { config, lang, reloadConfig } = useConfig();
  const { status, user, balance, signOut, refreshUser, requireAuth, applyUser } = useAuth();
  const [busy, setBusy] = useState<"signout" | "delete" | "avatar" | "cache" | null>(null);
  const [notice, setNotice] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const signedIn = status === "signed_in";
  const episodePrice = config.economy.episode_price;
  const isVip = Boolean(user?.is_vip);
  // Read on this screen so the streak can be shown where the viewer already is, rather than two taps away.
  const checkin = useQuery(async () => unwrap(await api.GET("/v1/rewards/checkin")), [], { enabled: signedIn });
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
      setToast(t("me.cache_cleared"));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch {
      setToast(t("me.cache_failed"));
    } finally {
      setBusy(null);
    }
  }, [reloadConfig, t]);

  const deleteAccount = useCallback(() => {
    Alert.alert(
      t("me.delete_account"),
      t("me.delete_warning"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.delete"),
          style: "destructive",
          onPress: async () => {
            setBusy("delete");
            setNotice(null);
            try {
              const { response } = await api.DELETE("/v1/auth/me");
              if (!response.ok) throw new Error(response.status === 401 ? t("me.reauth") : t("me.delete_failed"));
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
            accessibilityLabel={t("me.change_avatar")}
            style={styles.avatar}
          >
            {user?.avatar_url ? <Image source={user.avatar_url} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Icon name="me" size={28} color={colors.muted} />}
            {signedIn ? (
              <View style={styles.avatarBadge}>
                <Text variant="caption" color={colors.accentInk} style={{ fontSize: 10, lineHeight: 12 }}>
                  {busy === "avatar" ? "…" : t("common.edit")}
                </Text>
              </View>
            ) : null}
          </Pressable>
          <View style={{ flex: 1, gap: 2 }}>
            {status === "loading" ? (
              // Resolving the session used to flash "Guest" and then the real name — a signed-in viewer being
              // told for half a second that they are not.
              <>
                <Skeleton height={22} width="60%" />
                <Skeleton height={14} width="40%" />
              </>
            ) : signedIn && user ? (
              <>
                <Text variant="title" numberOfLines={1}>
                  {user.display_name ?? user.email ?? t("me.default_name")}
                </Text>
                <Text variant="caption">{t("me.id", { n: user.public_id })}</Text>
                {user.is_vip ? (
                  <Pill
                    label={user.vip_ends_at ? t("wallet.vip_until", { date: formatDate(user.vip_ends_at) }) : "VIP"}
                    tone="gold"
                    style={{ marginTop: 4 }}
                  />
                ) : null}
              </>
            ) : (
              <>
                <Text variant="title">{t("common.guest")}</Text>
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
            {/* A balance is unreadable until it is tied to what it buys. */}
            {signedIn && episodePrice > 0 ? (
              <Text variant="caption">{t("wallet.equivalent", { n: Math.floor(balance / episodePrice) })}</Text>
            ) : null}
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

        {/* VIP was a passive pill when active and nothing at all when not — a free ARPU line left undrawn. */}
        {signedIn && !isVip ? (
          <Card style={styles.walletCard}>
            <View style={{ flex: 1 }}>
              <Text variant="label">{t("me.vip_title")}</Text>
              <Text variant="caption">{t("me.vip_body")}</Text>
            </View>
            <Button title={t("me.vip_cta")} variant="secondary" small onPress={() => router.push("/wallet")} />
          </Card>
        ) : null}

        <Card style={{ padding: 0 }}>
          <ListRow
            title={t("rewards.title")}
            subtitle={
              checkin.data && checkin.data.streak_day > 0
                ? checkin.data.checked_in_today
                  ? t("rewards.checked_in_short", { d: checkin.data.streak_day })
                  : t("rewards.streak_at_risk", { d: checkin.data.streak_day })
                : t("me.rewards_hint")
            }
            onPress={() => {
              if (requireAuth()) router.push("/rewards");
            }}
            right={
              <View style={styles.giftRow}>
                {/* A dot when there is something to claim: a daily habit needs a visual pull. */}
                {checkin.data && !checkin.data.checked_in_today ? <View style={styles.dot} /> : null}
                <Icon name="gift" size={18} />
              </View>
            }
          />
          <Divider />
          <ListRow
            title={t("wallet.ledger")}
            subtitle={t("me.ledger_subtitle")}
            onPress={() => {
              if (requireAuth()) router.push("/wallet/ledger");
            }}
          />
          <Divider />
          <ListRow title={t("list.history")} subtitle={t("me.history_subtitle")} onPress={() => router.push("/(tabs)/list")} />
        </Card>

        <Text variant="caption" style={styles.sectionLabel}>
          {t("me.settings")}
        </Text>
        <Card style={{ padding: 0 }}>
          <ListRow title={t("me.language")} subtitle={language ? (language.native_name ?? language.name) : lang} onPress={() => router.push("/language")} />
          <Divider />
          {/* The retention loop exists now, so the viewer gets a switch for it — and per-channel control, since
              an app that can only be silenced entirely gets silenced entirely. */}
          {signedIn ? (
            <>
              <NotificationSettings />
              <Divider />
            </>
          ) : null}
          <ListRow
            title={busy === "cache" ? t("me.clearing") : t("me.clear_cache")}
            subtitle={t("me.cache_subtitle")}
            onPress={() => void clearCache()}
            disabled={busy !== null}
          />
          <Divider />
          <ListRow title={t("me.privacy")} onPress={openPrivacy} />
          <Divider />
          <ListRow title={t("me.terms")} onPress={openTerms} />
          {config.mobile.rate_us_url ? (
            <>
              <Divider />
              <ListRow title={t("me.rate")} onPress={openRateUs} />
            </>
          ) : null}
        </Card>

        {signedIn ? (
          <Card style={{ padding: 0 }}>
            <ListRow
              title={busy === "delete" ? t("me.deleting") : t("me.delete_account")}
              subtitle={t("me.delete_subtitle")}
              onPress={deleteAccount}
              disabled={busy !== null}
              destructive
            />
            <Divider />
            <Pressable onPress={onSignOut} disabled={busy !== null} accessibilityRole="button" style={({ pressed }) => [styles.signOut, pressed && { opacity: 0.7 }]}>
              <Text variant="label" color={colors.danger}>
                {busy === "signout" ? t("me.signing_out") : t("me.sign_out")}
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
  giftRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  walletCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderColor: colors.gold, borderRadius: radii.lg },
  coinRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  sectionLabel: { marginTop: spacing.sm, marginBottom: -spacing.sm, textTransform: "uppercase", letterSpacing: 1 },
  signOut: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 52, justifyContent: "center" },
  version: { textAlign: "center" },
});
