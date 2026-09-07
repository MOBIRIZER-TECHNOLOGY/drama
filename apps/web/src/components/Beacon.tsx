"use client";

import { useEffect } from "react";
import { track, type EventProps } from "@/lib/analytics";
import { rememberSearch } from "./SearchSuggestions";

/**
 * Fires one product event for a server-rendered screen. The props are serialised into the effect key, so the
 * event is sent once per distinct payload (e.g. once per search term) rather than on every re-render.
 */
export function Beacon({ name, props, remember }: { name: string; props?: EventProps; remember?: string }) {
  const payload = props ? JSON.stringify(props) : "";
  useEffect(() => {
    track(name, payload ? (JSON.parse(payload) as EventProps) : undefined);
    // A query is only worth remembering once it has actually been run, not while it is being typed.
    if (remember) rememberSearch(remember);
  }, [name, payload, remember]);
  return null;
}
