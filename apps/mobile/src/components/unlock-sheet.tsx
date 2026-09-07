import { colors, radii, spacing } from "@katha/tokens";
import * as Haptics from "expo-haptics";
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

export function UnlockSheet({
  episode,
  total,
  autoUnlock,
  onAutoUnlockChange,
  onUnlocked,
  onClose,
  onSignIn,
}: {
  episode: Episode;
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsTopUp, setNeedsTopUp] = useState(false);
  /** Adult title: the sheet swaps to the age confirmation, then retries the unlock it was asked for. */
  const [ageGateFor, setAgeGateFor] = useState<"coins" | "ad" | null>(null);
  const rewardedAds = config.flags.rewarded_ads === true;
  const enough = balance >= episode.price;
  const promptSignIn = useCallback(() => {
    if (onSignIn) onSignIn();
    else requireAuth();
  }, [onSignIn, requireAuth]);

  const unlock = useCallback(
    async (method: "coins" | "ad") => {
      if (status !== "signed_in") {
        promptSignIn();
        return;
      }
      setBusy(true);
      setError(null);
      const result = await unlockEpisode(episode.id, method, setBalance);
      setBusy(false);
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
        setError(`You need ${episode.price} coins to unlock this episode.`);
      } else if (result.code === "already_accessible") {
        onUnlocked();
      } else if (result.code === "sequential_unlock_required") {
        setError(result.message || t("series.locked_prev"));
      } else if (result.code === "ad_event_required") {
        setError("Ad verification failed. Try unlocking with coins.");
      } else {
        setError(result.message);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    },
    [episode.id, episode.number, episode.price, onUnlocked, promptSignIn, setBalance, status, t],
  );

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
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text variant="title">{t("player.unlock_title")}</Text>
          <Text variant="caption">
            Episode {episode.number} of {total}
          </Text>
        </View>
        {onClose ? (
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common.cancel")} hitSlop={10}>
            <Icon name="close" size={24} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.balanceRow}>
        <Text variant="body">{t("player.balance")}</Text>
        <View style={styles.balance}>
          <Icon name="coin" size={14} />
          <Text variant="label">{status === "signed_in" ? balance : "—"}</Text>
        </View>
      </View>

      {error ? (
        <Text variant="caption" color={colors.danger}>
          {error}
        </Text>
      ) : null}

      {status !== "signed_in" ? (
        <Button title={t("common.sign_in")} onPress={promptSignIn} />
      ) : needsTopUp || !enough ? (
        <Button
          title={`${t("player.top_up")} · ${episode.price} coins needed`}
          variant="gold"
          onPress={() => router.push("/wallet")}
          left={<Icon name="coin" size={14} />}
        />
      ) : (
        <Button
          title={t("player.unlock_coins", { n: episode.price })}
          onPress={() => unlock("coins")}
          loading={busy}
          left={<Icon name="coin" size={14} />}
        />
      )}

      {rewardedAds ? (
        // Ads are phase 2: the flag is off in production, and a real ad_event_id must come from the ad SDK.
        <Button title={t("player.watch_ad")} variant="secondary" onPress={() => unlock("ad")} disabled={busy} />
      ) : null}

      <View style={styles.toggleRow}>
        <View style={{ flex: 1 }}>
          <Text variant="label">{t("player.auto_unlock")}</Text>
          <Text variant="caption">Spend coins automatically when the next episode starts.</Text>
        </View>
        <Switch value={autoUnlock} onValueChange={onAutoUnlockChange} trackColor={{ true: colors.accent, false: colors.line }} thumbColor={colors.ink} />
      </View>
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
  header: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  balanceRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  balance: { flexDirection: "row", alignItems: "center", gap: 6 },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
});
