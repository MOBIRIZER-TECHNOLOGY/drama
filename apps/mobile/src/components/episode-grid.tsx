import { colors, radii, spacing } from "@katha/tokens";
import { memo, useMemo, useState } from "react";
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

/** Episodes per range chip. A 120-episode series was 120 mounted Pressables and one undifferentiated wall. */
const RANGE_SIZE = 50;

export const EpisodeGrid = memo(function EpisodeGrid({
  episodes,
  currentNumber,
  onPress,
}: {
  episodes: Episode[];
  currentNumber?: number | null;
  onPress: (ep: Episode, state: EpisodeLockState) => void;
}) {
  const ranges = useMemo(() => {
    if (episodes.length <= RANGE_SIZE) return [];
    const out: { from: number; to: number }[] = [];
    for (let i = 0; i < episodes.length; i += RANGE_SIZE) {
      out.push({ from: episodes[i].number, to: episodes[Math.min(i + RANGE_SIZE, episodes.length) - 1].number });
    }
    return out;
  }, [episodes]);

  // Open on the range holding the current episode, so a viewer deep in a series does not land on episode 1.
  const [range, setRange] = useState(() => {
    if (episodes.length <= RANGE_SIZE || !currentNumber) return 0;
    const index = episodes.findIndex((e) => e.number === currentNumber);
    return index >= 0 ? Math.floor(index / RANGE_SIZE) : 0;
  });

  const visible = ranges.length === 0 ? episodes : episodes.slice(range * RANGE_SIZE, (range + 1) * RANGE_SIZE);

  return (
    <>
    {ranges.length > 1 ? (
      <View style={styles.ranges}>
        {ranges.map((r, i) => (
          <Pressable
            key={r.from}
            onPress={() => setRange(i)}
            accessibilityRole="tab"
            accessibilityState={{ selected: i === range }}
            style={[styles.rangeChip, i === range && styles.rangeChipActive]}
          >
            <Text variant="caption" color={i === range ? colors.accentInk : colors.ink2}>
              {r.from}–{r.to}
            </Text>
          </Pressable>
        ))}
      </View>
    ) : null}
    <View style={styles.grid}>
      {visible.map((ep) => {
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
    </>
  );
});

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, paddingHorizontal: spacing.lg },
  ranges: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  rangeChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  rangeChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
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
