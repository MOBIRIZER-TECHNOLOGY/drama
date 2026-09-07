import Link from "next/link";
import { localeHref } from "@/lib/languages";
import type { CategoryOut } from "@/lib/types";

/** Horizontal category filter. Server-rendered links so the browse pages stay crawlable. */
export function CategoryBar({
  categories,
  lang,
  activeSlug,
  allLabel,
  label,
}: {
  categories: CategoryOut[];
  lang: string;
  /** Slug of the category page currently shown, or null on the "all" page. */
  activeSlug: string | null;
  allLabel: string;
  label: string;
}) {
  if (categories.length === 0) return null;
  const item = (active: boolean) =>
    `whitespace-nowrap rounded-pill border px-3.5 py-1.5 text-sm transition-colors ${
      active ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface text-ink2 hover:border-muted/60 hover:text-ink"
    }`;
  return (
    <nav aria-label={label} className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <Link href={localeHref(lang, "/series")} aria-current={activeSlug === null ? "page" : undefined} className={item(activeSlug === null)}>
        {allLabel}
      </Link>
      {categories.map((c) => (
        <Link
          key={c.id}
          href={localeHref(lang, `/category/${c.slug}`)}
          aria-current={activeSlug === c.slug ? "page" : undefined}
          className={item(activeSlug === c.slug)}
        >
          {c.name}
        </Link>
      ))}
    </nav>
  );
}
