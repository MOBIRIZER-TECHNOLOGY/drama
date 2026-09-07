"use client";

import { useCallback, useState } from "react";
import { useApp, useT } from "@/lib/app-context";
import { useAuth } from "@/lib/auth-context";
import { clientApi } from "@/lib/client-api";
import { call } from "@/lib/errors";
import { useLoader } from "@/lib/use-loader";
import type { HomeRail } from "@/lib/types";
import { Rail } from "./Rail";
import { SeriesCard, SeriesCardSkeleton } from "./SeriesCard";

/** Personal rails, in the order they are shown. `for_you` sits directly after Continue Watching. */
const PERSONAL_KEYS = ["continue", "for_you"] as const;

const FALLBACK_TITLES: Record<string, [string, string]> = {
  continue: ["home.continue_watching", "Continue Watching"],
  for_you: ["home.for_you", "For You"],
};

/**
 * The home page is server-rendered anonymously (and cached), so the signed-in rails are fetched in the browser.
 * Renders nothing for guests, and nothing when the API returns no personal rails.
 */
export function PersonalRails() {
  const t = useT();
  const { lang } = useApp();
  const { status, user } = useAuth();
  const [rails, setRails] = useState<HomeRail[] | null>(null);

  const load = useCallback(async () => {
    if (status !== "authenticated" || !user) return;
    const { data } = await call(() => clientApi.GET("/v1/home", { params: { query: { lang } } }));
    if (!data) {
      setRails([]); // a failed personal fetch simply hides these rails; the server rails below are untouched
      return;
    }
    const picked = PERSONAL_KEYS.map((key) => data.rails.find((r) => r.key === key)).filter(
      (r): r is HomeRail => !!r && r.items.length > 0,
    );
    setRails(picked);
  }, [status, user, lang]);

  useLoader(load);

  if (status !== "authenticated") return null;
  if (rails === null) {
    return (
      <div aria-hidden className="flex flex-col gap-10">
        <div>
          <div className="k-skeleton mx-4 mb-3 h-6 w-44 rounded-sm sm:mx-6 lg:mx-8" />
          <div className="no-scrollbar flex gap-3 overflow-hidden px-4 sm:px-6 lg:px-8">
            {Array.from({ length: 6 }).map((_, i) => (
              <SeriesCardSkeleton key={i} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {rails.map((rail) => {
        const fallback = FALLBACK_TITLES[rail.key];
        return (
          <Rail key={rail.key} id={`rail-${rail.key}`} title={fallback ? t(fallback[0], rail.title || fallback[1]) : rail.title}>
            {rail.items.map((s) => (
              <SeriesCard
                key={s.id}
                series={s}
                lang={lang}
                episodesLabel={t("series.eps", "eps")}
                freeLabel={t("series.free", "Free")}
              />
            ))}
          </Rail>
        );
      })}
    </>
  );
}
