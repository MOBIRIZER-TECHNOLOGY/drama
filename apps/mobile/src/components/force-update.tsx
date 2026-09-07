import { colors, radii, spacing } from "@katha/tokens";
import * as WebBrowser from "expo-web-browser";
import { useCallback } from "react";
import { Linking, StyleSheet, View } from "react-native";
import { Icon } from "@/components/icons";
import { Button, Screen, Text } from "@/components/ui";
import { getAppVersion, getStoreUrl, getVersionCode } from "@/lib/device";
import type { RemoteConfig } from "@/lib/types";

/**
 * True when the running binary is older than `config.mobile.min_version_code` and the server asks for a forced
 * update. Builds without a native version code (Expo Go, web) are never blocked: there is nothing to update to.
 */
export function needsForceUpdate(config: RemoteConfig): boolean {
  if (!config.mobile.force_update) return false;
  const min = config.mobile.min_version_code ?? 1;
  const current = getVersionCode();
  if (current === null) return false;
  return current < min;
}

/** Blocking screen rendered instead of the navigator; the only action is opening the store. */
export function ForceUpdateScreen({ config }: { config: RemoteConfig }) {
  const url = config.mobile.update_url ?? getStoreUrl();

  const open = useCallback(() => {
    // The store link leaves the app: try the OS handler first so Play/App Store opens natively.
    Linking.openURL(url).catch(() => {
      WebBrowser.openBrowserAsync(url).catch(() => {});
    });
  }, [url]);

  return (
    <Screen edges={["top", "bottom", "left", "right"]}>
      <View style={styles.body}>
        <View style={styles.badge}>
          <Icon name="download" size={30} color={colors.accent} />
        </View>
        <Text variant="display" style={styles.center}>
          Update Katha
        </Text>
        <Text variant="body" style={styles.center}>
          This version is no longer supported. Install the latest release to keep watching, and your coins, list and
          progress carry over.
        </Text>
        <Button title="Update now" onPress={open} style={styles.button} />
        <Text variant="caption" style={styles.center}>
          Installed: {getAppVersion()}
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg, paddingHorizontal: spacing.xl },
  badge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  center: { textAlign: "center" },
  button: { alignSelf: "stretch", borderRadius: radii.md, marginTop: spacing.sm },
});
