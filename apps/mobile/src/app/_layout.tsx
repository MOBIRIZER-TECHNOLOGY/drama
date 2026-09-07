import { colors } from "@katha/tokens";
import { DarkTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as WebBrowser from "expo-web-browser";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ForceUpdateScreen, needsForceUpdate } from "@/components/force-update";
import { PlayerPoolProvider } from "@/components/player/player-pool";
import { startAnalytics } from "@/lib/analytics";
import { AuthProvider } from "@/providers/auth";
import { ConfigProvider, useConfig } from "@/providers/config";

SplashScreen.preventAutoHideAsync().catch(() => {});
WebBrowser.maybeCompleteAuthSession();

const theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.accent,
    background: colors.ground,
    card: colors.surface,
    text: colors.ink,
    border: colors.line,
    notification: colors.accent,
  },
};

function RootNavigator() {
  const { ready, config, onboarded } = useConfig();

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    return startAnalytics();
  }, [ready]);

  if (!ready) return null;

  // Checked before the navigator so no route (including deep links) renders on an unsupported build.
  if (needsForceUpdate(config)) return <ForceUpdateScreen config={config} />;

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ground } }}>
      <Stack.Protected guard={!onboarded}>
        <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
      </Stack.Protected>
      <Stack.Protected guard={onboarded}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="series/[id]" />
        <Stack.Screen name="player/[seriesId]" options={{ animation: "fade", gestureEnabled: false }} />
        <Stack.Screen name="wallet/index" />
        <Stack.Screen name="wallet/ledger" />
        <Stack.Screen name="rewards" />
        <Stack.Screen name="language" />
        <Stack.Screen name="page/[slug]" />
        <Stack.Screen name="purchase" />
        <Stack.Screen name="auth" options={{ presentation: "modal" }} />
        <Stack.Screen name="search" options={{ presentation: "modal" }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.ground }}>
      <SafeAreaProvider>
        <ThemeProvider value={theme}>
          <ConfigProvider>
            <AuthProvider>
              <PlayerPoolProvider>
                <StatusBar style="light" />
                <RootNavigator />
              </PlayerPoolProvider>
            </AuthProvider>
          </ConfigProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
