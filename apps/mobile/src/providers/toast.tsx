import { colors, radii, spacing } from "@katha/tokens";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { FadeInDown, FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/icons";
import { Text } from "@/components/ui";

export type ToastTone = "info" | "success" | "error" | "gold";

/**
 * App-level toasts.
 *
 * The Toast component existed but was mounted on exactly one screen, so every other transient message — a
 * failed favourite, a claimed reward, a copied link — went to an inline caption somewhere the viewer was not
 * looking, or nowhere at all. Hosting it above the navigator means a message can also outlive the screen that
 * raised it, which matters when unlocking an episode navigates away as it succeeds.
 *
 * One at a time, newest wins: a queue on a phone means the viewer reads a stale message.
 */
type Toast = { id: number; message: string; tone: ToastTone };

const ToastContext = createContext<(message: string, tone?: ToastTone) => void>(() => {});

const TONE = {
  info: { color: colors.ink2, icon: null },
  success: { color: colors.success, icon: "check" },
  error: { color: colors.danger, icon: "close" },
  gold: { color: colors.gold, icon: "coin" },
} as const;

export function ToastProvider({ children }: PropsWithChildren) {
  const [toast, setToast] = useState<Toast | null>(null);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();

  const show = useCallback((message: string, tone: ToastTone = "info") => {
    if (timer.current) clearTimeout(timer.current);
    const id = ++seq.current;
    setToast({ id, message, tone });
    // Errors get longer, because they are usually longer and always more important to finish reading.
    timer.current = setTimeout(() => setToast((t) => (t?.id === id ? null : t)), tone === "error" ? 5000 : 2800);
  }, []);

  useEffect(() => () => (timer.current ? clearTimeout(timer.current) : undefined), []);

  const value = useMemo(() => show, [show]);
  const tone = toast ? TONE[toast.tone] : null;

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast && tone && (
        <Animated.View
          key={toast.id}
          entering={FadeInDown.duration(180)}
          exiting={FadeOut.duration(120)}
          // Sits above the tab bar rather than on it, and clears the gesture bar.
          style={[styles.wrap, { bottom: insets.bottom + 72 }]}
          pointerEvents="none"
          accessibilityLiveRegion="polite"
        >
          <View style={styles.toast}>
            {tone.icon ? <Icon name={tone.icon} size={16} color={tone.color} /> : null}
            <Text variant="label" color={colors.ink} style={styles.text}>
              {toast.message}
            </Text>
          </View>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, alignItems: "center", paddingHorizontal: spacing.xl },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  text: { flexShrink: 1 },
});
