import { colors, radii, spacing } from "@katha/tokens";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { memo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Pill, Text } from "@/components/ui";
import { formatCount } from "@/lib/format";
import type { SeriesCard as SeriesCardModel } from "@/lib/types";

export const CARD_WIDTH = 124;
export const CARD_HEIGHT = Math.round((CARD_WIDTH * 16) / 9);

export const SeriesCard = memo(function SeriesCard({
  series,
  width = CARD_WIDTH,
  subtitle,
  progress,
  onPress,
}: {
  series: SeriesCardModel;
  width?: number;
  subtitle?: string;
  /** 0..1 progress bar for continue-watching cards */
  progress?: number;
  onPress?: () => void;
}) {
  const router = useRouter();
  const height = Math.round((width * 16) / 9);
  return (
    <Pressable
      onPress={onPress ?? (() => router.push({ pathname: "/series/[id]", params: { id: series.id } }))}
      accessibilityRole="button"
      accessibilityLabel={series.title}
      style={({ pressed }) => [{ width, opacity: pressed ? 0.85 : 1 }]}
    >
      <View style={[styles.poster, { width, height }]}>
        <Image source={series.cover_url} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} recyclingKey={series.id} />
        {series.is_premium ? <Pill label="VIP" tone="gold" style={styles.badge} /> : null}
        {typeof progress === "number" ? (
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` }]} />
          </View>
        ) : null}
      </View>
      <Text variant="label" numberOfLines={1} style={styles.title}>
        {series.title}
      </Text>
      <Text variant="caption" numberOfLines={1}>
        {subtitle ?? `${series.episode_count} ep · ${formatCount(series.view_count)} views`}
      </Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  poster: {
    borderRadius: radii.md,
    overflow: "hidden",
    backgroundColor: colors.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  badge: { position: "absolute", top: spacing.sm, left: spacing.sm },
  title: { marginTop: spacing.sm },
  progressTrack: { position: "absolute", left: 0, right: 0, bottom: 0, height: 3, backgroundColor: "rgba(255,255,255,0.25)" },
  progressFill: { height: 3, backgroundColor: colors.accent },
});
