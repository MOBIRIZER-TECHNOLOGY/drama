"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "@/lib/app-context";
import { IconChevronLeft, IconChevronRight } from "./ui/icons";

/** Horizontal, snap-scrolling row with arrow buttons on wide screens. Children are rendered on the server. */
export function Rail({
  title,
  action,
  children,
  id,
}: {
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const x = Math.abs(el.scrollLeft);
    setCanLeft(x > 4);
    setCanRight(x < max - 4);
  }, []);

  useEffect(() => {
    update();
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    el.addEventListener("scroll", update, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", update);
    };
  }, [update]);

  const scrollBy = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const rtl = getComputedStyle(el).direction === "rtl";
    el.scrollBy({ left: dir * el.clientWidth * 0.8 * (rtl ? -1 : 1), behavior: "smooth" });
  };

  return (
    <section id={id} className="relative" aria-label={typeof title === "string" ? title : undefined}>
      <div className="mb-3 flex items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <h2 className="font-display text-lg font-semibold text-ink sm:text-xl">{title}</h2>
        <div className="flex items-center gap-2">
          {action}
          <div className="hidden gap-1 md:flex">
            <button
              type="button"
              onClick={() => scrollBy(-1)}
              disabled={!canLeft}
              aria-label={t("common.scroll_back", "Scroll back")}
              className="rounded-pill border border-line p-1.5 text-ink2 hover:bg-surface2 disabled:opacity-30"
            >
              <IconChevronLeft size={16} className="rtl:rotate-180" />
            </button>
            <button
              type="button"
              onClick={() => scrollBy(1)}
              disabled={!canRight}
              aria-label={t("common.scroll_forward", "Scroll forward")}
              className="rounded-pill border border-line p-1.5 text-ink2 hover:bg-surface2 disabled:opacity-30"
            >
              <IconChevronRight size={16} className="rtl:rotate-180" />
            </button>
          </div>
        </div>
      </div>
      <div
        ref={ref}
        className="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:px-6 lg:px-8"
      >
        {children}
      </div>
    </section>
  );
}
