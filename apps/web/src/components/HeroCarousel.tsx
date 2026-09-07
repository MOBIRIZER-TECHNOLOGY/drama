"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useHref, useT } from "@/lib/app-context";
import type { SeriesCard } from "@/lib/types";
import { buttonClass } from "./ui/Button";
import { IconChevronLeft, IconChevronRight, IconPause, IconPlay } from "./ui/icons";

const INTERVAL_MS = 6000;

export function HeroCarousel({ items }: { items: SeriesCard[] }) {
  const t = useT();
  const href = useHref();
  const [index, setIndex] = useState(0);
  const [hovering, setHovering] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const touchStart = useRef<number | null>(null);
  const count = items.length;

  const go = useCallback((next: number) => setIndex(((next % count) + count) % count), [count]);
  const paused = hovering || userPaused;

  useEffect(() => {
    if (count < 2 || paused) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const id = setInterval(() => go(index + 1), INTERVAL_MS);
    return () => clearInterval(id);
  }, [count, paused, index, go]);

  if (count === 0) return null;

  /** Only the active slide and its neighbours are mounted so a long featured rail does not load every banner. */
  const mounted = (i: number) => {
    if (count <= 3) return true;
    const d = Math.abs(i - index);
    return d <= 1 || d === count - 1;
  };

  return (
    <section
      aria-roledescription="carousel"
      aria-label={t("home.featured", "Featured")}
      className="relative mx-auto w-full max-w-[1400px] px-0 sm:px-6 lg:px-8"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onFocusCapture={() => setHovering(true)}
      onBlurCapture={() => setHovering(false)}
      onTouchStart={(e) => (touchStart.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchStart.current == null) return;
        const dx = e.changedTouches[0].clientX - touchStart.current;
        touchStart.current = null;
        if (Math.abs(dx) > 40) go(index + (dx < 0 ? 1 : -1));
      }}
    >
      <div
        aria-live={paused ? "polite" : "off"}
        aria-atomic="false"
        className="relative aspect-[3/4] w-full overflow-hidden bg-surface sm:aspect-[16/8] sm:rounded-lg sm:border sm:border-line lg:aspect-[21/9]"
      >
        {items.map((s, i) => {
          if (!mounted(i)) return null;
          const img = s.banner_url || s.cover_url;
          const active = i === index;
          return (
            <div
              key={s.id}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} / ${count}`}
              aria-hidden={!active}
              className={`absolute inset-0 transition-opacity duration-700 ${active ? "opacity-100" : "pointer-events-none opacity-0"}`}
            >
              {img ? (
                <Image src={img} alt="" fill priority={i === 0} sizes="(min-width: 1400px) 1400px, 100vw" className="object-cover" />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-surface2 to-ground" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-ground via-ground/60 to-transparent sm:bg-gradient-to-r sm:from-ground/95 sm:via-ground/50 sm:to-transparent" />
              <div className="absolute inset-x-0 bottom-0 flex flex-col gap-3 p-5 sm:inset-y-0 sm:max-w-xl sm:justify-center sm:p-10">
                <div className="flex flex-wrap items-center gap-2 text-xs text-ink2">
                  <span className="rounded-pill bg-accent px-2 py-0.5 font-semibold text-accent-ink">{t("home.featured", "Featured")}</span>
                  {s.categories.slice(0, 3).map((c) => (
                    <span key={c.id} className="rounded-pill border border-line/80 bg-black/30 px-2 py-0.5">
                      {c.name}
                    </span>
                  ))}
                  <span className="text-muted">
                    {s.episode_count} {t("series.episodes", "episodes")}
                  </span>
                </div>
                <h2 className="font-display text-2xl font-bold leading-tight text-ink sm:text-4xl lg:text-5xl">{s.title}</h2>
                {s.synopsis && <p className="line-clamp-2 max-w-lg text-sm text-ink2 sm:line-clamp-3 sm:text-base">{s.synopsis}</p>}
                <div className="mt-1 flex items-center gap-2">
                  <Link href={href(`/series/${s.slug}?ep=1`)} className={buttonClass("primary", "lg")} tabIndex={active ? 0 : -1}>
                    <IconPlay size={18} />
                    {t("home.watch_now", "Watch now")}
                  </Link>
                  <Link href={href(`/series/${s.slug}`)} className={buttonClass("secondary", "lg")} tabIndex={active ? 0 : -1}>
                    {t("home.details", "Details")}
                  </Link>
                </div>
              </div>
            </div>
          );
        })}

        {count > 1 && (
          <>
            <button
              type="button"
              onClick={() => go(index - 1)}
              aria-label={t("common.previous", "Previous")}
              className="absolute start-2 top-1/2 hidden -translate-y-1/2 rounded-pill bg-black/40 p-2 text-ink hover:bg-black/60 sm:block"
            >
              <IconChevronLeft className="rtl:rotate-180" />
            </button>
            <button
              type="button"
              onClick={() => go(index + 1)}
              aria-label={t("common.next", "Next")}
              className="absolute end-2 top-1/2 hidden -translate-y-1/2 rounded-pill bg-black/40 p-2 text-ink hover:bg-black/60 sm:block"
            >
              <IconChevronRight className="rtl:rotate-180" />
            </button>
            <div className="absolute inset-x-0 bottom-2 flex items-center justify-center gap-1.5 sm:bottom-4">
              <button
                type="button"
                onClick={() => setUserPaused((v) => !v)}
                aria-pressed={userPaused}
                aria-label={userPaused ? t("home.carousel_play", "Resume slideshow") : t("home.carousel_pause", "Pause slideshow")}
                className="me-2 rounded-pill bg-black/40 p-1 text-ink hover:bg-black/60"
              >
                {userPaused ? <IconPlay size={12} /> : <IconPause size={12} />}
              </button>
              {items.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => go(i)}
                  aria-label={t("home.go_to_slide", "Slide {n} of {count}", { n: i + 1, count })}
                  aria-current={i === index}
                  className={`h-1.5 rounded-pill transition-all ${i === index ? "w-6 bg-accent" : "w-1.5 bg-ink/40 hover:bg-ink/70"}`}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
