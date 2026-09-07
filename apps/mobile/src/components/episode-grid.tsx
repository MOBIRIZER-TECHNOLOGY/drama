import { colors, radii, spacing } from "@katha/tokens";
import { memo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Icon } from "@/components/icons";
import { Text } from "@/components/ui";
import type { Episode } from "@/lib/types";

export type EpisodeLockState = "free" | "unlocked" | "unlockable" | "locked_sequential";

/** Derive the render state from the flags the episode list already carries plus the sequential rule. */
export function lockState(ep: Episode, episodes: Episode[]): EpisodeLockState {
  if (ep.is_free) return "free";
  if (ep.accessible || ep.unlocked) return "unlocked";
  const highestAccessible = episodes.reduce((max, e) => (e.accessible || e.is_free ? Math.max(max, e.number) : max), 0);
  return ep.number === highestAccessible + 1 ? "unlockable" : "locked_sequential";
}

export const EpisodeGrid = memo(function EpisodeGrid({
  episodes,
  currentNumber,
  onPress,
}: {
  episodes: Episode[];
  currentNumber?: number | null;
  onPress: (ep: Episode, state: EpisodeLockState) => void;
}) {
  return (
    <View style={styles.grid}>
      {episodes.map((ep) => {
        const state = lockState(ep, episodes);
        const isCurrent = ep.number === currentNumber;
        const locked = state === "unlockable" || state === "locked_sequential";
        return (
          <Pressable
            key={ep.id}
            onPress={() => onPress(ep, state)}
            accessibilityRole="button"
            accessibilityLabel={`Episode ${ep.number}${locked ? ", locked" : ""}`}
            style={({ pressed }) => [
              styles.cell,
              isCurrent && styles.cellCurrent,
              state === "locked_sequential" && styles.cellDim,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text variant="label" color={isCurrent ? colors.accentInk : colors.ink}>
              {ep.number}
            </Text>
            {locked ? (
              <View style={styles.lock}>
                <Icon name="lock" size={9} />
              </View>
            ) : state === "free" ? (
              <Text variant="caption" color={isCurrent ? colors.accentInk : colors.success} style={styles.tag}>
                Free
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, paddingHorizontal: spacing.lg },
  cell: {
    width: 56,
    height: 56,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
  },
  cellCurrent: { backgroundColor: colors.accent, borderColor: colors.accent },
  cellDim: { opacity: 0.55 },
  lock: { position: "absolute", top: 3, right: 3 },
  tag: { fontSize: 9, lineHeight: 11, position: "absolute", bottom: 4 },
});
