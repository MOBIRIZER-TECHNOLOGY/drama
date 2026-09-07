"use client";

import { useMemo, useState } from "react";
import { useT } from "@/lib/app-context";
import type { EpisodeOut } from "@/lib/types";
import { IconCoin, IconLock, IconPlay } from "../ui/icons";
import { highestAccessibleNumber, lockState } from "./lock-state";

/**
 * Episodes per range chip. A dripping series runs to 60-120 episodes, and rendering all of them meant that many
 * mounted buttons and a wall of identical squares with no way to reach episode 94 except scrolling.
 */
const RANGE_SIZE = 50;

export function EpisodeGrid({
  episodes,
  currentId,
  continueNumber,
  onSelect,
}: {
  episodes: EpisodeOut[];
  currentId: string | null;
  continueNumber: number | null;
  onSelect: (ep: EpisodeOut) => void;
}) {
  const t = useT();
  const highest = highestAccessibleNumber(episodes);

  const ranges = useMemo(() => {
    if (episodes.length <= RANGE_SIZE) return [];
    const out: { from: number; to: number }[] = [];
    for (let i = 0; i < episodes.length; i += RANGE_SIZE) {
      out.push({ from: episodes[i].number, to: episodes[Math.min(i + RANGE_SIZE, episodes.length) - 1].number });
    }
    return out;
  }, [episodes]);

  // Open on the range holding the current episode, so arriving deep in a series does not start at episode 1.
  const [range, setRange] = useState(() => {
    if (episodes.length <= RANGE_SIZE) return 0;
    const index = episodes.findIndex((e) => e.id === currentId);
    return index >= 0 ? Math.floor(index / RANGE_SIZE) : 0;
  });

  const visible = ranges.length === 0 ? episodes : episodes.slice(range * RANGE_SIZE, (range + 1) * RANGE_SIZE);

  return (
    <div>
      {ranges.length > 1 && (
        <div className="no-scrollbar mb-3 flex gap-2 overflow-x-auto" role="tablist" aria-label={t("series.episode_ranges", "Episode ranges")}>
          {ranges.map((r, i) => (
            <button
              key={r.from}
              type="button"
              role="tab"
              aria-selected={i === range}
              onClick={() => setRange(i)}
              className={`shrink-0 rounded-pill border px-3 py-1 text-sm transition-colors ${
                i === range ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface text-ink2 hover:text-ink"
              }`}
            >
              {r.from}–{r.to}
            </button>
          ))}
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <Legend className="bg-surface2 text-ink2">{t("series.legend_free", "Free / unlocked")}</Legend>
        <Legend className="border border-gold/60 text-gold">{t("series.legend_next", "Unlock next")}</Legend>
        <Legend className="bg-surface text-muted opacity-60">{t("series.legend_later", "Unlock previous first")}</Legend>
      </div>
      <ul className="grid grid-cols-5 gap-2 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-8 xl:grid-cols-10 2xl:grid-cols-12" aria-label={t("series.episodes", "Episodes")}>
        {visible.map((ep) => {
          const state = lockState(ep, highest);
          const current = ep.id === currentId;
          const isContinue = continueNumber === ep.number && !current;
          const label =
            state === "free"
              ? t("series.free", "Free")
              : state === "accessible"
                ? t("series.unlocked", "Unlocked")
                : state === "next"
                  ? t("series.unlock_for", "Unlock for {price} coins", { price: ep.price })
                  : t("series.unlock_previous_first", "Unlock previous episodes first");
          const base =
            "relative flex aspect-square w-full flex-col items-center justify-center rounded-md border text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";
          const cls = current
            ? "border-accent bg-accent text-accent-ink"
            : state === "next"
              ? "border-gold/60 bg-surface text-ink hover:bg-surface2"
              : state === "later"
                ? "border-line bg-surface text-muted opacity-60 hover:opacity-80"
                : "border-line bg-surface2 text-ink hover:border-muted/60";
          return (
            <li key={ep.id}>
              <button
                type="button"
                onClick={() => onSelect(ep)}
                aria-current={current ? "true" : undefined}
                aria-label={`${t("series.episode", "Episode")} ${ep.number}${ep.title ? ` – ${ep.title}` : ""}. ${label}`}
                title={ep.title ? `${ep.number}. ${ep.title} — ${label}` : label}
                className={`${base} ${cls}`}
              >
                <span className="font-display text-base leading-none sm:text-lg">{ep.number}</span>
                {current ? (
                  <IconPlay size={12} className="mt-1" />
                ) : state === "next" ? (
                  <span className="mt-1 inline-flex items-center gap-0.5 text-[10px] text-gold">
                    <IconCoin size={11} />
                    {ep.price}
                  </span>
                ) : state === "later" ? (
                  <IconLock size={12} className="mt-1" />
                ) : (
                  <span className="mt-1 h-3" />
                )}
                {isContinue && (
                  <span className="absolute -top-1.5 start-1/2 -translate-x-1/2 rounded-pill bg-accent px-1.5 text-[9px] font-semibold uppercase text-accent-ink rtl:translate-x-1/2">
                    {t("series.continue", "Resume")}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Legend({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-3 w-3 rounded-sm ${className}`} aria-hidden />
      {children}
    </span>
  );
}
