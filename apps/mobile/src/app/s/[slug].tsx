import { Redirect, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { Loading } from "@/components/ui";
import { track } from "@/lib/analytics";
import { stashRoute } from "@/lib/pending-route";
import { useConfig } from "@/providers/config";

/**
 * Universal link target: https://katha.app/s/{slug} opens the series (the API accepts id or slug).
 *
 * On a fresh install the onboarding guard owns the navigator, and this route used to redirect straight into it,
 * so the slug was discarded and the viewer landed on Home having never seen what their friend sent — the moment
 * a share is worth the most. The target is now parked and honoured once onboarding finishes.
 */
export default function SeriesLinkScreen() {
  const { slug, ep, ref, utm_source: utmSource } = useLocalSearchParams<{
    slug: string;
    ep?: string;
    ref?: string;
    utm_source?: string;
  }>();
  const { onboarded } = useConfig();

  const params: Record<string, string> = { id: slug };
  if (ep) params.episode = ep;

  useEffect(() => {
    track("deep_link_open", { slug, episode: ep ?? null, ref: ref ?? null, source: utmSource ?? null, onboarded });
    if (!onboarded) void stashRoute("/series/[id]", params);
    // Fires once per arrival; params is derived from the same values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, ep, ref, utmSource, onboarded]);

  // While onboarding owns the navigator, render nothing rather than redirect into a guard that will bounce us.
  if (!onboarded) return <Loading />;
  return <Redirect href={{ pathname: "/series/[id]", params }} />;
}
