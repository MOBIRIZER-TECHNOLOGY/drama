import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { track } from "@/lib/analytics";
import { routeFor } from "@/lib/push";

/**
 * Sends the viewer where a notification asked them to go.
 *
 * Covers both cases: a tap while the app is running, and a cold start launched by the notification itself —
 * `getLastNotificationResponse` is the only way to see the second, and missing it means a push that opens the
 * app to the home tab, which reads as the notification having lied.
 *
 * Mounted inside the navigator so `router.push` has somewhere to push to.
 */
export function PushRouter({ enabled }: { enabled: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;

    const go = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      // Clearing it means a remount does not navigate a second time, and is why no "already handled" ref
      // is needed. (SDK 57: the *Async variants of both calls are deprecated.)
      Notifications.clearLastNotificationResponse();

      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      track("notification_open", { channel: typeof data?.channel === "string" ? data.channel : "unknown" });
      const target = routeFor(data);
      if (target) router.push({ pathname: target.pathname as never, params: target.params as never });
    };

    // Launched by a tap while the app was closed: without this the push opens the home tab and reads as a lie.
    go(Notifications.getLastNotificationResponse());
    const sub = Notifications.addNotificationResponseReceivedListener(go);
    return () => sub.remove();
  }, [enabled, router]);

  return null;
}
