import { colors } from "@katha/tokens";
import { Tabs } from "expo-router";
import { StyleSheet, type ColorValue } from "react-native";
import { Icon, type IconName } from "@/components/icons";
import { useT } from "@/hooks/use-translations";

function tabIcon(name: IconName) {
  return function TabIcon({ color }: { color: ColorValue }) {
    return <Icon name={name} size={20} color={color} />;
  };
}

export default function TabsLayout() {
  const t = useT();
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
      <Tabs.Screen name="me" options={{ title: t("tabs.me"), tabBarIcon: tabIcon("me") }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: colors.ground, borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth },
  barOnBlack: { backgroundColor: "#000000", borderTopColor: "#000000" },
  label: { fontSize: 11, fontWeight: "600" },
});
