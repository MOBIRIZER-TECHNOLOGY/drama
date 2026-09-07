import { colors, radii, spacing } from "@katha/tokens";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Switch, View } from "react-native";
import { AgeGateSheet } from "@/components/age-gate";
import { Icon } from "@/components/icons";
import { Button, Text } from "@/components/ui";
import { useT } from "@/hooks/use-translations";
import { track } from "@/lib/analytics";
import { api } from "@/lib/api";
import { errorCode, errorMessage, RequestError, unwrap } from "@/lib/errors";
import { getBool, setBool } from "@/lib/storage";
import type { Episode } from "@/lib/types";
import { useAuth } from "@/providers/auth";
import { useConfig } from "@/providers/config";

export type UnlockOutcome = { ok: true } | { ok: false; code: string; message: string };

/** POST /unlock with the standard error handling. Returns the outcome; updates balance on success. */
export async function unlockEpisode(episodeId: string, method: "coins" | "ad", setBalance: (n: number) => void, adEventId?: string): Promise<UnlockOutcome> {
  try {
    const out = unwrap(
      await api.POST("/v1/episodes/{episode_id}/unlock", {
        params: { path: { episode_id: episodeId } },
        body: { method, ad_event_id: adEventId ?? null },
      }),
    );
    setBalance(out.coin_balance);
    return { ok: true };
  } catch (e) {
    const code = errorCode(e);
    if (e instanceof RequestError && e.status === 402) return { ok: false, code: "insufficient_coins", message: e.message };
    return { ok: false, code, message: errorMessage(e) };
  }
}

export function useAutoUnlock() {
  const [autoUnlock, setAutoUnlockState] = useState(false);
  useEffect(() => {
    getBool("autoUnlock").then(setAutoUnlockState);
  }, []);
  const setAutoUnlock = useCallback((v: boolean) => {
    setAutoUnlockState(v);
    void setBool("autoUnlock", v);
  }, []);
  return { autoUnlock, setAutoUnlock };
}

type Bundle = { episode_count: number; list_price: number; price: number; discount_pct: number; saving: number; affordable: boolean };

/**
 * The paywall. Every rupee this product earns passes through this sheet, so it is written as an offer rather
 * than as a bill: it shows what is being bought, where the viewer is in the series, what the purchase leaves
 * them with, and the two alternatives to paying full price one episode at a time.
 *
 * The balance sits inside the primary button on purpose — affordability should cost no eye movement — and the
 * bundle is a peer option rather than something a viewer has to know to ask for.
 */
export function UnlockSheet({
  episode,
  seriesId,
  total,
  autoUnlock,
  onAutoUnlockChange,
  onUnlocked,
  onClose,
  onSignIn,
}: {
  episode: Episode;
  seriesId: string;
  total: number;
  autoUnlock: boolean;
  onAutoUnlockChange: (v: boolean) => void;
  onUnlocked: () => void;
  onClose?: () => void;
  /** Sign-in entry point that preserves the caller's state (e.g. the player's current episode). */
  onSignIn?: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const { config } = useConfig();
  const { balance, setBalance, status, requireAuth, applyUser } = useAuth();
  const [busy, setBusy] = useState<"coins" | "ad" | "bundle" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsTopUp, setNeedsTopUp] = useState(false);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  /** Adult title: the sheet swaps to the age confirmation, then retries the unlock it was asked for. */
  const [ageGateFor, setAgeGateFor] = useState<"coins" | "ad" | null>(null);
  const rewardedAds = config.flags.rewarded_ads === true;
  const signupBonus = config.rewards.signup_bonus ?? 0;
  const enough = balance >= episode.price;
  const signedIn = status === "signed_in";

  const promptSignIn = useCallback(() => {
    if (onSignIn) onSignIn();
    else requireAuth();
  }, [onSignIn, requireAuth]);

  useEffect(() => {
    track("paywall_view", { episode_id: episode.id, episode_number: episode.number, price: episode.price, balance });
    // Announced once per episode; the balance is captured for the funnel, not as a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episode.id]);

  // Price the rest of the series so the bundle can be offered rather than merely existing on the server.
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    void (async () => {
      try {
        const out = unwrap(await api.GET("/v1/series/{series_id}/bundle", { params: { path: { series_id: seriesId } } }));
        if (live) setBundle(out);
      } catch {
        // A bundle we cannot price is simply not offered.
      }
    })();
    return () => {
      live = false;
    };
  }, [seriesId, signedIn]);

  const unlock = useCallback(
    async (method: "coins" | "ad") => {
      if (!signedIn) {
        promptSignIn();
        return;
      }
      setBusy(method);
      setError(null);
      const result = await unlockEpisode(episode.id, method, setBalance);
      setBusy(null);
      if (result.ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        track("unlock", { episode_id: episode.id, episode_number: episode.number, method, price: episode.price });
        onUnlocked();
        return;
      }
      if (result.code === "age_gate_required") {
        setAgeGateFor(method);
      } else if (result.code === "insufficient_coins") {
        setNeedsTopUp(true);
        setError(t("player.unlock_need", { n: episode.price }));
      } else if (result.code === "already_accessible") {
        onUnlocked();
      } else if (result.code === "sequential_unlock_required") {
        setError(result.message || t("series.locked_prev"));
      } else if (result.code === "ad_event_required") {
        // Never phrase a failed reward as if the viewer cheated; the reward simply did not arrive.
        setError(t("player.ad_failed"));
      } else {
        setError(result.message);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    },
    [episode.id, episode.number, episode.price, onUnlocked, promptSignIn, setBalance, signedIn, t],
  );

  const unlockBundle = useCallback(async () => {
    if (!signedIn) return promptSignIn();
    setBusy("bundle");
    setError(null);
    try {
      const out = unwrap(await api.POST("/v1/series/{series_id}/bundle", { params: { path: { series_id: seriesId } } }));
      setBalance(out.coin_balance);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      track("unlock_bundle", { series_id: seriesId, episodes: out.episode_ids.length, spent: out.spent });
      onUnlocked();
    } catch (e) {
      const code = errorCode(e);
      if (code === "age_gate_required") setAgeGateFor("coins");
      else if (code === "insufficient_coins") setNeedsTopUp(true);
      setError(errorMessage(e));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      setBusy(null);
    }
  }, [seriesId, signedIn, promptSignIn, setBalance, onUnlocked]);

  const topUp = useCallback(() => {
    // Carry the episode through, so the wallet can hand the viewer back rather than stranding them.
    router.push({ pathname: "/wallet", params: { need: String(Math.max(0, episode.price - balance)), episode: episode.id, series: seriesId } });
  }, [router, episode.price, episode.id, balance, seriesId]);

  if (ageGateFor) {
    return (
      <AgeGateSheet
        onCancel={() => setAgeGateFor(null)}
        onConfirmed={(u) => {
          applyUser(u);
          const method = ageGateFor;
          setAgeGateFor(null);
          void unlock(method);
        }}
      />
    );
  }

  return (
    <View style={styles.sheet} accessibilityViewIsModal>
      <View style={styles.handle} />

      {/* Show the thing being sold. A paywall with no image is a receipt. */}
      <View style={styles.still}>
        {episode.thumbnail_url ? (
          <Image source={{ uri: episode.thumbnail_url }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={14} transition={120} />
        ) : null}
        <View style={styles.stillScrim} />
        <Icon name="lock" size={22} color={colors.gold} />
        <Text variant="label" numberOfLines={1} style={styles.stillTitle}>
          {episode.title ?? t("player.unlock_title")}
        </Text>
        <Text variant="caption">{t("player.unlock_position", { n: episode.number, total })}</Text>
      </View>

      {onClose ? (
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common.close")} hitSlop={12} style={styles.close}>
          <Icon name="close" size={22} />
        </Pressable>
      ) : null}

      {error ? (
        <Text variant="caption" color={colors.danger}>
          {error}
        </Text>
      ) : null}

      {!signedIn ? (
        <>
          <Button
            title={signupBonus > 0 ? t("player.signin_bonus", { n: signupBonus }) : t("common.sign_in")}
            variant="gold"
            onPress={promptSignIn}
          />
          <Text variant="caption" style={styles.centred}>
            {t("player.unlock_need", { n: episode.price })}
          </Text>
        </>
      ) : needsTopUp || !enough ? (
        <Button
          title={t("player.top_up")}
          subtitle={t("player.unlock_need", { n: episode.price - balance })}
          variant="gold"
          onPress={topUp}
          left={<Icon name="coin" size={14} />}
        />
      ) : (
        <Button
          title={t("player.unlock_coins", { n: episode.price })}
          subtitle={t("player.balance_after", { n: balance, after: balance - episode.price })}
          onPress={() => unlock("coins")}
          loading={busy === "coins"}
          disabled={busy !== null}
          left={<Icon name="coin" size={14} />}
        />
      )}

      {/* The bundle: the highest-ARPU control in this category, and previously absent. */}
      {signedIn && bundle && bundle.episode_count > 1 ? (
        <View style={styles.bundle}>
          <View style={styles.bundleHead}>
            <Text variant="label" style={{ flex: 1 }}>
              {t("player.bundle_title", { n: bundle.episode_count })}
            </Text>
            {bundle.discount_pct > 0 ? (
              <View style={styles.savePill}>
                <Text variant="caption" color={colors.accentInk}>
                  {t("player.bundle_save", { pct: bundle.discount_pct })}
                </Text>
              </View>
            ) : null}
          </View>
          <Text variant="caption">
            <Text variant="caption" style={styles.strike}>
              {bundle.list_price}
            </Text>
            {"  "}
            <Text variant="label" color={colors.gold}>
              {bundle.price}
            </Text>
          </Text>
          <Button
            title={bundle.affordable ? t("player.bundle_cta") : t("player.top_up")}
            variant="secondary"
            loading={busy === "bundle"}
            disabled={busy !== null}
            onPress={bundle.affordable ? unlockBundle : topUp}
          />
        </View>
      ) : null}

      {rewardedAds ? (
        // Ads are phase 2: the flag is off in production, and a real ad_event_id must come from the ad SDK.
        <Button title={t("player.watch_ad")} variant="secondary" onPress={() => unlock("ad")} disabled={busy !== null} />
      ) : null}

      {/* Auto-unlock is the mechanic that turns a binge into spend; framed as a benefit, not a setting. */}
      <View style={styles.toggleRow}>
        <View style={{ flex: 1 }}>
          <Text variant="label">{t("player.auto_unlock")}</Text>
          <Text variant="caption">{t("player.auto_unlock_hint")}</Text>
        </View>
        <Switch value={autoUnlock} onValueChange={onAutoUnlockChange} trackColor={{ true: colors.accent, false: colors.line }} thumbColor={colors.ink} />
      </View>

      <Text variant="caption" style={styles.centred}>
        {t("player.sequential_hint")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    padding: spacing.xl,
    gap: spacing.lg,
  },
  handle: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: colors.line, marginTop: -spacing.sm },
  still: {
    height: 132,
    borderRadius: radii.md,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    backgroundColor: colors.surface2,
  },
  stillScrim: { position: "absolute", inset: 0, backgroundColor: "rgba(20,16,19,0.62)" },
  stillTitle: { paddingHorizontal: spacing.lg, textAlign: "center" },
  close: { position: "absolute", top: spacing.md, right: spacing.md, zIndex: 2 },
  bundle: {
    borderWidth: 1,
    borderColor: colors.gold,
    borderRadius: radii.md,
    padding: spacing.lg,
    gap: spacing.sm,
    backgroundColor: colors.surface2,
  },
  bundleHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  savePill: { backgroundColor: colors.gold, borderRadius: 999, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  strike: { textDecorationLine: "line-through" },
  centred: { textAlign: "center" },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
});
