"use client";

import { useEffect } from "react";
import { track, type EventProps } from "@/lib/analytics";

/**
 * Fires one product event for a server-rendered screen. The props are serialised into the effect key, so the
 * event is sent once per distinct payload (e.g. once per search term) rather than on every re-render.
 */
export function Beacon({ name, props }: { name: string; props?: EventProps }) {
  const payload = props ? JSON.stringify(props) : "";
  useEffect(() => {
    track(name, payload ? (JSON.parse(payload) as EventProps) : undefined);
  }, [name, payload]);
  return null;
}
