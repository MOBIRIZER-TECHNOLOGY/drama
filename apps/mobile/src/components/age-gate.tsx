import { colors, radii, spacing } from "@katha/tokens";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Icon } from "@/components/icons";
import { Button, Text } from "@/components/ui";
import { useT } from "@/hooks/use-translations";
import { api } from "@/lib/api";
import { errorMessage, unwrap } from "@/lib/errors";
import type { UserOut } from "@/lib/types";

/** `PATCH /v1/auth/me {age_confirmed: true}`; the updated profile carries `age_confirmed_at`. */
export async function confirmAge(): Promise<UserOut> {
  return unwrap(await api.PATCH("/v1/auth/me", { body: { age_confirmed: true } }));
}

/**
 * Blocking confirmation for adult titles. Shown after a 403/409 `age_gate_required`; on success the caller
 * retries the action that failed. Guests never reach it: `requireAuth()` opens the auth modal first.
 */
export function AgeGateSheet({
  onConfirmed,
  onCancel,
}: {
  /** Called with the refreshed profile once the PATCH succeeds; retry the gated action here. */
  onConfirmed: (user: UserOut) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      onConfirmed(await confirmAge());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [onConfirmed]);

  return (
    <View style={styles.sheet} accessibilityViewIsModal>
      <View style={styles.handle} />
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text variant="title">Mature content</Text>
          <Text variant="caption">This title is intended for adult viewers.</Text>
        </View>
        <Pressable onPress={onCancel} accessibilityRole="button" accessibilityLabel={t("common.cancel")} hitSlop={10}>
          <Icon name="close" size={24} />
        </Pressable>
      </View>

      <Text variant="body">
        Confirm your age to continue. We store only that you confirmed, and you will not be asked again on this account.
      </Text>

      {error ? (
        <Text variant="caption" color={colors.danger}>
          {error}
        </Text>
      ) : null}

      <Button title="I am 18 or older" onPress={confirm} loading={busy} />
      <Button title={t("common.cancel")} variant="ghost" onPress={onCancel} disabled={busy} />
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
});
