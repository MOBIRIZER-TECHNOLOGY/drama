"use client";

import { useEffect, useSyncExternalStore } from "react";
import { track } from "@/lib/analytics";
import { useT } from "@/lib/app-context";
import { IconAlert } from "./ui/icons";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** Connectivity is external state, so it is read rather than mirrored into a state variable. */
const isOffline = () => navigator.onLine === false;
/** The server has no connection to report, and rendering the banner during SSR would flash it on every load. */
const serverSnapshot = () => false;

/**
 * Tells the viewer when the problem is their connection, not the app.
 *
 * Nothing in the product detected offline, so an intermittent connection — by far the most common failure for
 * this audience — surfaced as a generic crash screen or a silently empty rail. Naming it costs one listener and
 * stops the viewer concluding the app is broken.
 *
 * `navigator.onLine` is only trustworthy in the negative: false reliably means no network, while true only
 * means an interface is up. So this shows on `offline` and clears on `online`, and never contradicts a working
 * request.
 */
export function OfflineBanner() {
  const t = useT();
  const offline = useSyncExternalStore(subscribe, isOffline, serverSnapshot);

  useEffect(() => {
    if (offline) track("offline", { state: "offline" });
  }, [offline]);

  if (!offline) return null;

  return (
    <div
      role="status"
      className="k-rise sticky top-14 z-40 flex items-center justify-center gap-2 border-b border-warning/40 bg-warning/15 px-4 py-2 text-sm text-ink sm:top-16"
    >
      <IconAlert size={15} className="shrink-0 text-warning" />
      {t("common.offline_banner", "You are offline. Some things will not load until you reconnect.")}
    </div>
  );
}
