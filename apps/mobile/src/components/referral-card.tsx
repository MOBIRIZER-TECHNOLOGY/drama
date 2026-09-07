import { colors, radii, spacing } from "@katha/tokens";
import * as Clipboard from "expo-clipboard";
import { useCallback, useState } from "react";
import { Share, StyleSheet, View } from "react-native";
import { Icon } from "@/components/icons";
import { Button, Card, Text } from "@/components/ui";
import { useT } from "@/hooks/use-translations";
import { track } from "@/lib/analytics";
import { referralUrl } from "@/lib/format";
import { useAuth } from "@/providers/auth";
import { useConfig } from "@/providers/config";

/**
 * The referral loop, surfaced.
 *
 * The server has linked referrers to referees and paid out since day one; the app showed the code nowhere at
 * all, so there was nothing to share and no reason to ask. In this market a two-sided invite outperforms paid
 * acquisition, and Rewards is where people already come to earn.
 */
export function ReferralCard() {
  const t = useT();
  const { config } = useConfig();
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);

  const code = user?.referral_code;
  const referral = config.referral;
  const referrerCoins = referral?.referrer_coins ?? 0;
  const refereeCoins = referral?.referee_coins ?? 0;

  const link = code ? referralUrl(code) : "";

  const share = useCallback(async () => {
    if (!code) return;
    track("referral_share", { method: "share" });
    try {
      await Share.share({
        message: t("referral.message", { link }),
        url: link,
      });
    } catch {
      // The sheet was dismissed.
    }
  }, [code, link, t]);

  const copy = useCallback(async () => {
    if (!code) return;
    await Clipboard.setStringAsync(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    track("referral_share", { method: "copy" });
  }, [code, link]);

  if (!code || referral?.enabled === false) return null;

  return (
    <Card style={styles.card}>
      <Text variant="heading">
        {referrerCoins > 0 ? t("referral.title", { n: referrerCoins }) : t("referral.title_plain")}
      </Text>
      <Text variant="caption">
        {t("referral.hint", { referee: refereeCoins, referrer: referrerCoins })}
      </Text>
      <View style={styles.row}>
        <View style={styles.code}>
          <Text variant="label" color={colors.gold}>
            {code}
          </Text>
        </View>
        <Button
          title={copied ? t("referral.copied_short") : t("referral.copy")}
          variant="secondary"
          small
          onPress={() => void copy()}
          left={<Icon name={copied ? "check" : "share"} size={14} />}
        />
        <Button
          title={t("referral.share")}
          variant="gold"
          small
          onPress={() => void share()}
          left={<Icon name="share" size={14} color={colors.accentInk} />}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, borderColor: colors.gold },
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.xs },
  code: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: colors.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
});
