import { colors } from "@katha/tokens";
import { Tabs } from "expo-router";
import { useEffect, useSyncExternalStore } from "react";
import { AppState, StyleSheet, type ColorValue } from "react-native";
import { Icon, type IconName } from "@/components/icons";
import { useT } from "@/hooks/use-translations";
import * as checkinBadge from "@/lib/checkin-badge";
import { useAuth } from "@/providers/auth";
import { useConfig } from "@/providers/config";

function tabIcon(name: IconName) {
  return function TabIcon({ color }: { color: ColorValue }) {
    return <Icon name={name} size={20} color={color} />;
  };
}

export default function TabsLayout() {
  const t = useT();
  const { status } = useAuth();
  const { config } = useConfig();
  const enabled = status === "signed_in" && config.rewards.enabled !== false;
  const unclaimed = useSyncExternalStore(checkinBadge.subscribe, checkinBadge.getSnapshot, checkinBadge.getSnapshot);

  // Checked on mount and whenever the app comes back to the foreground — the check-in rolls over at midnight
  // IST, so a session left open overnight would otherwise show yesterday's answer.
  useEffect(() => {
    void checkinBadge.refresh(enabled);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void checkinBadge.refresh(enabled);
    });
    return () => sub.remove();
  }, [enabled]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.bar,
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: styles.label,
        sceneStyle: { backgroundColor: colors.ground },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t("tabs.home"), tabBarIcon: tabIcon("home") }} />
      <Tabs.Screen
        name="shorts"
        options={{ title: t("tabs.shorts"), tabBarIcon: tabIcon("shorts"), tabBarStyle: [styles.bar, styles.barOnBlack] }}
      />
      <Tabs.Screen name="list" options={{ title: t("tabs.list"), tabBarIcon: tabIcon("list") }} />
      <Tabs.Screen
        name="me"
        options={{
          title: t("tabs.me"),
          tabBarIcon: tabIcon("me"),
          // A dot, not a count: there is exactly one thing waiting and a number would imply otherwise.
          tabBarBadge: unclaimed ? "" : undefined,
          tabBarBadgeStyle: styles.dot,
          tabBarAccessibilityLabel: unclaimed ? `${t("tabs.me")} · ${t("rewards.checkin")}` : t("tabs.me"),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: colors.ground, borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth },
  barOnBlack: { backgroundColor: "#000000", borderTopColor: "#000000" },
  label: { fontSize: 11, fontWeight: "600" },
  dot: { backgroundColor: colors.accent, minWidth: 10, maxWidth: 10, height: 10, borderRadius: 5, lineHeight: 10 },
});
