"use client";

import Image from "next/image";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { useApp, useT } from "@/lib/app-context";
import { useAuth } from "@/lib/auth-context";
import * as guestHistory from "@/lib/guest-history";
import { localeHref } from "@/lib/languages";
import { Rail } from "./Rail";
import { IconPlay } from "./ui/icons";

/**
 * Continue Watching for people who have not signed in.
 *
 * The server-side rail needs an account, so a guest's four episodes of last night left no trace on the home
 * page and the app silently asked them to search for the series again. This reads the local record the player
 * keeps, and doubles as the honest reason to make an account: the note under the rail says where it lives.
 *
 * Storage is external state, so it is subscribed to rather than mirrored into `useState` — a write from the
 * player (or another tab) updates this rail without a reload.
 */
export function GuestContinue() {
  const t = useT();
  const { lang } = useApp();
  const { status, openAuth } = useAuth();
  const rows = useSyncExternalStore(guestHistory.subscribe, guestHistory.getSnapshot, guestHistory.getServerSnapshot);

  if (status !== "anonymous" || rows.length === 0) return null;

  return (
    <Rail
      id="rail-guest-continue"
      title={t("home.continue_watching", "Continue Watching")}
      action={
        <button
          type="button"
          onClick={() => openAuth()}
          className="text-sm text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          {t("home.guest_continue_save", "Save across devices")}
        </button>
      }
    >
      {rows.map((row) => (
        <Link
          key={row.seriesId}
          href={localeHref(lang, `/series/${row.slug}/${row.episodeNumber}`)}
          className="group block w-[9.5rem] shrink-0 snap-start sm:w-44 md:w-48"
          aria-label={t("home.guest_continue_item", "{title} · episode {n}", { title: row.title, n: row.episodeNumber })}
        >
          <div className="relative aspect-[9/16] overflow-hidden rounded-md border border-line bg-surface">
            {row.coverUrl ? (
              <Image
                src={row.coverUrl}
                alt=""
                fill
                sizes="(max-width: 640px) 40vw, 12rem"
                className="object-cover transition-transform duration-300 group-hover:scale-105"
              />
            ) : null}
            <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
              <span className="rounded-full bg-ground/70 p-2 text-ink">
                <IconPlay className="h-5 w-5" />
              </span>
            </span>
          </div>
          <p className="mt-2 truncate text-sm font-medium text-ink">{row.title}</p>
          <p className="truncate text-xs text-muted">
            {t("series.episode", "Episode")} {row.episodeNumber}
          </p>
        </Link>
      ))}
    </Rail>
  );
}
