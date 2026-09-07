import { colors } from "@katha/tokens";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, View, type ColorValue, type StyleProp, type ViewStyle } from "react-native";

/** Icon names used across the app, mapped to Ionicons glyphs. */
export type IconName =
  | "home"
  | "shorts"
  | "list"
  | "me"
  | "search"
  | "back"
  | "close"
  | "play"
  | "pause"
  | "heart"
  | "heart-filled"
  | "bookmark"
  | "bookmark-filled"
  | "share"
  | "episodes"
  | "lock"
  | "mute"
  | "unmute"
  | "expand"
  | "collapse"
  | "coin"
  | "check"
  | "gift"
  | "download"
  | "chevron";

const glyphs: Record<Exclude<IconName, "coin">, React.ComponentProps<typeof Ionicons>["name"]> = {
  home: "home-outline",
  shorts: "play-circle-outline",
  list: "bookmark-outline",
  me: "person-circle-outline",
  search: "search-outline",
  back: "chevron-back",
  close: "close",
  play: "play",
  pause: "pause",
  heart: "heart-outline",
  "heart-filled": "heart",
  bookmark: "bookmark-outline",
  "bookmark-filled": "bookmark",
  share: "share-social-outline",
  episodes: "grid-outline",
  lock: "lock-closed",
  mute: "volume-mute-outline",
  unmute: "volume-high-outline",
  expand: "expand-outline",
  collapse: "contract-outline",
  check: "checkmark",
  gift: "gift-outline",
  download: "cloud-download-outline",
  chevron: "chevron-forward",
};

export function Icon({ name, size = 20, color = colors.ink, style }: { name: IconName; size?: number; color?: ColorValue; style?: StyleProp<ViewStyle> }) {
  if (name === "coin") {
    return (
      <View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.gold, borderWidth: 1.5, borderColor: "#B98F2E" }, style]} />
    );
  }
  return (
    <View style={[styles.box, { width: size + 4, height: size + 4 }, style]}>
      <Ionicons name={glyphs[name]} size={size} color={color} />
    </View>
  );
}

const styles = StyleSheet.create({ box: { alignItems: "center", justifyContent: "center" } });
