import { colors, radii, spacing } from "@katha/tokens";
import { useEffect, type PropsWithChildren, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text as RNText,
  TextInput as RNTextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

export { colors, radii, spacing };

type TextVariant = "display" | "title" | "heading" | "body" | "caption" | "label";

/**
 * Font families registered by the expo-font config plugin (assets/fonts, named after the files). Static weights
 * are selected by family name; `fontWeight` is not set so Android does not synthesise a second bold.
 */
export const fonts = {
  displaySemiBold: "BricolageGrotesque-SemiBold",
  displayBold: "BricolageGrotesque-Bold",
  regular: "IBMPlexSans-Regular",
  medium: "IBMPlexSans-Medium",
  semiBold: "IBMPlexSans-SemiBold",
  bold: "IBMPlexSans-Bold",
} as const;

const textStyles: Record<TextVariant, TextStyle> = {
  display: { fontFamily: fonts.displayBold, fontSize: 30, lineHeight: 36, color: colors.ink, letterSpacing: -0.5 },
  title: { fontFamily: fonts.displaySemiBold, fontSize: 22, lineHeight: 28, color: colors.ink },
  heading: { fontFamily: fonts.semiBold, fontSize: 17, lineHeight: 22, color: colors.ink },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21, color: colors.ink2 },
  caption: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16, color: colors.muted },
  label: { fontFamily: fonts.semiBold, fontSize: 13, lineHeight: 18, color: colors.ink },
};

export function Text({ variant = "body", style, color, ...rest }: TextProps & { variant?: TextVariant; color?: string }) {
  return <RNText {...rest} style={[textStyles[variant], color ? { color } : null, style]} />;
}

export function Screen({
  children,
  edges = ["top", "left", "right"],
  style,
  padded,
}: PropsWithChildren<{ edges?: Edge[]; style?: StyleProp<ViewStyle>; padded?: boolean }>) {
  return (
    <SafeAreaView edges={edges} style={[styles.screen, padded && styles.padded, style]}>
      {children}
    </SafeAreaView>
  );
}

export function Card({ style, ...rest }: ViewProps) {
  return <View {...rest} style={[styles.card, style]} />;
}

export function Row({ style, ...rest }: ViewProps) {
  return <View {...rest} style={[styles.row, style]} />;
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "gold" | "danger";

export function Button({
  title,
  variant = "primary",
  loading,
  disabled,
  style,
  left,
  small,
  ...rest
}: Omit<PressableProps, "style"> & {
  title: string;
  variant?: ButtonVariant;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  left?: ReactNode;
  small?: boolean;
}) {
  const bg =
    variant === "primary"
      ? colors.accent
      : variant === "gold"
        ? colors.gold
        : variant === "secondary"
          ? colors.surface2
          : variant === "danger"
            ? "transparent"
            : "transparent";
  const fg = variant === "primary" || variant === "gold" ? colors.accentInk : variant === "danger" ? colors.danger : colors.ink;
  const isDisabled = disabled || loading;
  return (
    <Pressable
      {...rest}
      disabled={isDisabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        { backgroundColor: bg, opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1 },
        variant === "ghost" && styles.buttonGhost,
        variant === "danger" && styles.buttonDanger,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {left}
          <RNText style={[styles.buttonText, small && styles.buttonTextSmall, { color: fg }]}>{title}</RNText>
        </>
      )}
    </Pressable>
  );
}

export function TextInput({ style, ...rest }: TextInputProps) {
  return (
    <RNTextInput
      placeholderTextColor={colors.muted}
      selectionColor={colors.accent}
      keyboardAppearance="dark"
      {...rest}
      style={[styles.input, style]}
    />
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.accent} size="large" />
      {label ? (
        <Text variant="caption" style={styles.centerText}>
          {label}
        </Text>
      ) : null}
    </View>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <View style={styles.center}>
      <Text variant="heading" style={styles.centerText}>
        {title}
      </Text>
      {body ? (
        <Text variant="body" style={styles.centerText}>
          {body}
        </Text>
      ) : null}
      {action ? <View style={styles.centerAction}>{action}</View> : null}
    </View>
  );
}

export function ErrorState({ message, onRetry, retryLabel = "Retry" }: { message: string; onRetry?: () => void; retryLabel?: string }) {
  return (
    <View style={styles.center}>
      <Text variant="heading" style={styles.centerText}>
        Something went wrong
      </Text>
      <Text variant="body" style={styles.centerText}>
        {message}
      </Text>
      {onRetry ? (
        <View style={styles.centerAction}>
          <Button title={retryLabel} variant="secondary" onPress={onRetry} small />
        </View>
      ) : null}
    </View>
  );
}

export function Skeleton({ width, height, radius = radii.md, style }: { width?: number | `${number}%`; height: number; radius?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ width: width ?? "100%", height, borderRadius: radius, backgroundColor: colors.surface2 }, style]} />;
}

export function Pill({ label, tone = "muted", style }: { label: string; tone?: "muted" | "accent" | "gold" | "success"; style?: StyleProp<ViewStyle> }) {
  const bg = tone === "accent" ? colors.accent : tone === "gold" ? colors.gold : tone === "success" ? colors.success : colors.surface2;
  const fg = tone === "muted" ? colors.ink2 : colors.accentInk;
  return (
    <View style={[styles.pill, { backgroundColor: bg }, style]}>
      <RNText style={[styles.pillText, { color: fg }]}>{label}</RNText>
    </View>
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.divider, style]} />;
}

export function SectionHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      <Text variant="heading">{title}</Text>
      {right}
    </View>
  );
}

export function Coin({ size = 14 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.gold, borderWidth: 1.5, borderColor: "#B98F2E" }} />
  );
}

/**
 * Transient message pinned above the tab bar. Renders nothing when `message` is null and calls `onHide`
 * after `duration`, so the owner can keep it in a single piece of state.
 */
export function Toast({ message, onHide, duration = 2600 }: { message: string | null; onHide: () => void; duration?: number }) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onHide, duration);
    return () => clearTimeout(timer);
  }, [message, onHide, duration]);
  if (!message) return null;
  return (
    <View style={styles.toastWrap} pointerEvents="none" accessibilityLiveRegion="polite">
      <View style={styles.toast}>
        <Text variant="label" color={colors.ink} style={styles.toastText}>
          {message}
        </Text>
      </View>
    </View>
  );
}

export function ListRow({
  title,
  subtitle,
  right,
  onPress,
  disabled,
  destructive,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || !onPress}
      accessibilityRole={onPress ? "button" : undefined}
      style={({ pressed }) => [styles.listRow, pressed && { backgroundColor: colors.surface2 }, disabled && { opacity: 0.5 }]}
    >
      <View style={{ flex: 1 }}>
        <Text variant="label" color={destructive ? colors.danger : colors.ink}>
          {title}
        </Text>
        {subtitle ? <Text variant="caption">{subtitle}</Text> : null}
      </View>
      {right ?? (onPress ? <Text variant="caption">›</Text> : null)}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  padded: { paddingHorizontal: spacing.lg },
  card: { backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, padding: spacing.lg },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  button: {
    minHeight: 48,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  buttonSmall: { minHeight: 36, paddingHorizontal: spacing.lg, borderRadius: radii.sm },
  buttonGhost: { borderWidth: 1, borderColor: colors.line },
  buttonDanger: { borderWidth: 1, borderColor: colors.danger },
  buttonText: { fontFamily: fonts.bold, fontSize: 15 },
  buttonTextSmall: { fontSize: 13 },
  input: {
    minHeight: 48,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    color: colors.ink,
    paddingHorizontal: spacing.lg,
    fontSize: 15,
    fontFamily: fonts.regular,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.sm, minHeight: 200 },
  centerText: { textAlign: "center" },
  centerAction: { marginTop: spacing.sm },
  pill: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radii.pill, alignSelf: "flex-start" },
  pillText: { fontFamily: fonts.bold, fontSize: 11 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  toastWrap: { position: "absolute", left: 0, right: 0, bottom: spacing.xxl, alignItems: "center", paddingHorizontal: spacing.lg },
  toast: {
    maxWidth: "100%",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  toastText: { textAlign: "center" },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    minHeight: 52,
  },
});
