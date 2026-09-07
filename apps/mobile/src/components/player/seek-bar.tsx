import { colors, spacing } from "@katha/tokens";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { Text } from "@/components/ui";
import { formatTime } from "@/lib/format";

const THUMB = 14;

/**
 * Scrubber driven by a Reanimated shared value: the pan runs on the UI thread and only the final position
 * crosses to JS (`onSeek`). Horizontal-only so the vertical pager keeps its swipe.
 */
export function SeekBar({ position, duration, onSeek }: { position: number; duration: number; onSeek: (sec: number) => void }) {
  const [width, setWidth] = useState(1);
  const [scrubLabel, setScrubLabel] = useState<number | null>(null);
  const ratio = useSharedValue(0);
  const scrubbing = useSharedValue(false);

  // Follow playback while the user is not dragging. (.get()/.set() keep the React Compiler happy.)
  useEffect(() => {
    if (!scrubbing.get()) ratio.set(duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0);
  }, [position, duration, ratio, scrubbing]);

  const onLayout = useCallback((e: LayoutChangeEvent) => setWidth(Math.max(1, e.nativeEvent.layout.width)), []);

  const commit = useCallback(
    (r: number) => {
      setScrubLabel(null);
      onSeek(r * duration);
    },
    [onSeek, duration],
  );
  const preview = useCallback((r: number) => setScrubLabel(r * duration), [duration]);

  const pan = Gesture.Pan()
    .activeOffsetX([-8, 8])
    .failOffsetY([-12, 12])
    .onBegin((e) => {
      scrubbing.set(true);
      ratio.set(Math.min(1, Math.max(0, e.x / width)));
    })
    .onUpdate((e) => {
      const r = Math.min(1, Math.max(0, e.x / width));
      ratio.set(r);
      runOnJS(preview)(r);
    })
    .onEnd(() => {
      scrubbing.set(false);
      runOnJS(commit)(ratio.get());
    })
    .onFinalize((_e, success) => {
      if (!success) {
        scrubbing.set(false);
        runOnJS(preview)(-1);
      }
    });

  const fillStyle = useAnimatedStyle(() => ({ width: ratio.get() * width }));
  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: ratio.get() * width - THUMB / 2 }] }));

  const shown = scrubLabel !== null && scrubLabel >= 0 ? scrubLabel : position;

  return (
    <View style={styles.wrap}>
      <GestureDetector gesture={pan}>
        <View style={styles.track} onLayout={onLayout} accessibilityRole="adjustable" accessibilityLabel="Seek">
          <View style={styles.rail} />
          <Animated.View style={[styles.fill, fillStyle]} />
          <Animated.View style={[styles.thumb, thumbStyle]} />
        </View>
      </GestureDetector>
      <View style={styles.times}>
        <Text variant="caption" color={colors.ink2}>
          {formatTime(shown)}
        </Text>
        <Text variant="caption" color={colors.ink2}>
          {formatTime(duration)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.lg },
  track: { height: 28, justifyContent: "center" },
  rail: { height: 3, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.3)" },
  fill: { position: "absolute", left: 0, height: 3, borderRadius: 2, backgroundColor: colors.accent },
  thumb: { position: "absolute", left: 0, width: THUMB, height: THUMB, borderRadius: THUMB / 2, backgroundColor: colors.ink },
  times: { flexDirection: "row", justifyContent: "space-between" },
});
