import Image from "next/image";
import Link from "next/link";
import { localeHref } from "@/lib/languages";
import type { SeriesCard as SeriesCardT } from "@/lib/types";
import { IconLock, IconPlay } from "./ui/icons";

export function SeriesCard({
  series,
  lang,
  priority = false,
  className = "",
  episodesLabel = "eps",
  freeLabel = "Free",
  rank,
}: {
  series: SeriesCardT;
  lang: string;
  priority?: boolean;
  className?: string;
  episodesLabel?: string;
  freeLabel?: string;
  /** Position in a ranked rail. A numbered row is the highest-CTR format in this category. */
  rank?: number;
}) {
  const href = localeHref(lang, `/series/${series.slug}`);
  return (
    <Link
      href={href}
      className={`group block shrink-0 snap-start ${rank ? "ms-6 w-[9.5rem] sm:w-44 md:w-48" : "w-[9.5rem] sm:w-44 md:w-48"} ${className}`}
      aria-label={rank ? `${rank}. ${series.title}` : series.title}
    >
      <div className="relative aspect-[9/16] rounded-md border border-line bg-surface">
        {/* Outline numeral hanging off the poster's leading edge — the standard ranked-rail treatment, and why
            the card carries a leading margin when ranked. */}
        {rank ? (
          <span
            aria-hidden
            className="font-display pointer-events-none absolute bottom-0 start-0 z-10 -translate-x-[0.42em] select-none text-[5rem] font-bold leading-[0.72] text-ground sm:text-[6rem] rtl:translate-x-[0.42em]"
            style={{ WebkitTextStroke: "2px var(--k-line-strong)" }}
          >
            {rank}
          </span>
        ) : null}
        <div className="absolute inset-0 overflow-hidden rounded-md">
        {series.cover_url ? (
          <Image
            src={series.cover_url}
            alt=""
            fill
            sizes="(min-width: 768px) 12rem, 9.5rem"
            priority={priority}
            className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-surface2 to-ground">
            <span className="font-display px-3 text-center text-sm text-muted">{series.title}</span>
          </div>
        )}
        {/* Ratings were added to the API so clients could warn before playback, and then rendered nowhere: a
            UA16 title looked identical to a U until playback was refused. India's IT Rules expect a prominent
            classification, and a parent has no other signal. */}
        {series.content_rating && (
          <span
            className={`absolute start-1.5 top-1.5 rounded-sm border px-1 py-px text-[10px] font-semibold leading-tight ${
              series.is_adult ? "border-danger/60 bg-black/70 text-danger" : "border-line bg-black/60 text-ink2"
            }`}
            title={series.is_adult ? "Mature content" : "Content rating"}
          >
            {series.content_rating}
          </span>
        )}
        {/* A dripping catalogue lives on the next-episode promise, so say when it last moved. */}
        {series.completion_status && (
          <span className="absolute end-1.5 top-1.5 rounded-sm bg-black/60 px-1 py-px text-[10px] leading-tight text-ink2">
            {series.completion_status}
          </span>
        )}
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 to-transparent" />
        <div className="absolute inset-x-2 bottom-2 flex items-end justify-between gap-2 text-[11px] text-ink2">
          <span>
            {series.episode_count} {episodesLabel}
          </span>
          {series.is_premium ? (
            <span className="inline-flex items-center gap-1 rounded-pill bg-black/50 px-1.5 py-0.5 text-gold">
              <IconLock size={11} />
              {series.free_episodes > 0 ? `${series.free_episodes} ${freeLabel.toLowerCase()}` : "VIP"}
            </span>
          ) : (
            <span className="rounded-pill bg-black/50 px-1.5 py-0.5 text-success">{freeLabel}</span>
          )}
        </div>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <span className="rounded-pill bg-accent/90 p-3 text-accent-ink">
            <IconPlay size={22} />
          </span>
        </div>
        </div>
      </div>
      <h3 className="mt-2 line-clamp-2 text-sm font-medium leading-snug text-ink">{series.title}</h3>
      {series.categories.length > 0 && (
        <p className="mt-0.5 line-clamp-1 text-xs text-muted">{series.categories.map((c) => c.name).join(" · ")}</p>
      )}
    </Link>
  );
}

export function SeriesCardSkeleton({ className = "w-[9.5rem] shrink-0 sm:w-44 md:w-48" }: { className?: string }) {
  return (
    <div className={className}>
      <div className="k-skeleton aspect-[9/16] rounded-md" />
      <div className="k-skeleton mt-2 h-4 w-3/4 rounded-sm" />
      <div className="k-skeleton mt-1.5 h-3 w-1/2 rounded-sm" />
    </div>
  );
}
