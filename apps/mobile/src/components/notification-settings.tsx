import { colors } from "@katha/tokens";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Linking, Switch, View } from "react-native";
import { Divider, ListRow } from "@/components/ui";
import { useT } from "@/hooks/use-translations";
import { track } from "@/lib/analytics";
import { api } from "@/lib/api";
import { unwrap } from "@/lib/errors";
import { ensureRegistered, pushPermission, unregister } from "@/lib/push";
import { useAuth } from "@/providers/auth";

/**
 * Notification controls.
 *
 * There was no notifications section at all, because there were no notifications. Now that the retention loop
 * exists, a viewer needs both a master switch and per-channel control — an app that can only be silenced
 * entirely gets silenced entirely.
 *
 * The master switch reflects OS permission, which the viewer can revoke from Settings while the app is
 * backgrounded, so it is re-read on foreground rather than trusted from the last time we asked.
 */

const CHANNELS = [
  { key: "new_episode", label: "New episodes", hint: "When a series you watch gets a new episode" },
  { key: "streak", label: "Streak reminders", hint: "Before your daily streak runs out" },
  { key: "resume", label: "Unfinished episodes", hint: "A nudge about something you started" },
  { key: "offer", label: "Offers", hint: "Discounts and limited-time coin bonuses" },
] as const;

export function NotificationSettings() {
  const t = useT();
  const { user, applyUser } = useAuth();
  const [granted, setGranted] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setGranted((await pushPermission()) === "granted");
  }, []);

  // Re-read on focus rather than caching: the viewer can revoke permission in system settings while we are
  // backgrounded, and this also covers coming back from the settings app we send them to below.
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const toggleMaster = useCallback(
    async (next: boolean) => {
      setBusy(true);
      try {
        if (next) {
          const ok = await ensureRegistered();
          track("notification_permission", { granted: ok, source: "settings" });
          if (!ok) {
            // Denied once, the OS will not ask again: the only route left is system settings.
            await refresh();
            void Linking.openSettings();
            return;
          }
        } else {
          await unregister();
        }
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const toggleChannel = useCallback(
    async (key: string, on: boolean) => {
      // The schema types this as an open record; the API only ever stores booleans here.
      const current = (user?.notification_prefs ?? {}) as Record<string, boolean>;
      const prefs: Record<string, boolean> = { ...current, [key]: on };
      // Optimistic: a preference toggle that waits on a round trip feels broken.
      applyUser({ ...user!, notification_prefs: prefs });
      try {
        const updated = unwrap(await api.PATCH("/v1/auth/me", { body: { notification_prefs: prefs } }));
        applyUser(updated);
      } catch {
        applyUser({ ...user!, notification_prefs: current });
      }
    },
    [user, applyUser],
  );

  const prefs = (user?.notification_prefs ?? {}) as Record<string, boolean>;

  return (
    <>
      <ListRow
        title={t("notifications.title")}
        subtitle={granted === false ? t("notifications.hint") : undefined}
        right={
          <Switch
            value={granted === true}
            disabled={busy || granted === null}
            onValueChange={(v) => void toggleMaster(v)}
            trackColor={{ true: colors.accent, false: colors.line }}
            thumbColor={colors.ink}
          />
        }
      />
      {granted &&
        CHANNELS.map((c) => (
          <View key={c.key}>
            <Divider />
            <ListRow
              title={c.label}
              subtitle={c.hint}
              right={
                <Switch
                  value={prefs[c.key] !== false}
                  onValueChange={(v) => void toggleChannel(c.key, v)}
                  trackColor={{ true: colors.accent, false: colors.line }}
                  thumbColor={colors.ink}
                />
              }
            />
          </View>
        ))}
    </>
  );
}
