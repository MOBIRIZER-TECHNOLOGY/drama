import Link from "next/link";
import { localeHref } from "@/lib/languages";
import type { CategoryOut } from "@/lib/types";

export type Facets = { category?: string; status?: string; length?: string };

/**
 * Narrowing a search.
 *
 * The results grid was all-or-nothing: a query like "revenge" returned forty titles in no particular shape and
 * the only way to narrow it was a better query. These are the three questions this audience actually asks —
 * which genre, is it finished, how long is it — and none of them could be asked.
 *
 * Rendered as links, so a filtered search is shareable and survives a page that has not loaded its JavaScript
 * yet. The page is `noindex` anyway, so there is no duplicate-content cost to the parameters.
 */
const STATUS = ["completed", "ongoing"] as const;
const LENGTH = ["short", "medium", "long"] as const;

export function SearchFacets({
  q,
  lang,
  active,
  categories,
  labels,
}: {
  q: string;
  lang: string;
  active: Facets;
  categories: CategoryOut[];
  labels: {
    group: string;
    genre: string;
    status: string;
    length: string;
    any: string;
    completed: string;
    ongoing: string;
    short: string;
    medium: string;
    long: string;
    clear: string;
  };
}) {
  /** Toggling a facet clears it when it is already on, so the same control turns a filter off. */
  const href = (patch: Facets) => {
    const next: Facets = { ...active, ...patch };
    const params = new URLSearchParams({ q });
    for (const [key, value] of Object.entries(next)) if (value) params.set(key, value);
    return localeHref(lang, `/search?${params}`);
  };

  const chip = (on: boolean) =>
    `whitespace-nowrap rounded-pill border px-3 py-1 text-sm transition-colors ${
      on ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface text-ink2 hover:border-muted/60 hover:text-ink"
    }`;

  const anyActive = Boolean(active.category || active.status || active.length);

  return (
    <div className="flex flex-col gap-3" role="group" aria-label={labels.group}>
      <Row label={labels.genre}>
        <Link href={href({ category: undefined })} className={chip(!active.category)}>
          {labels.any}
        </Link>
        {categories.map((c) => (
          <Link
            key={c.id}
            href={href({ category: active.category === c.slug ? undefined : c.slug })}
            aria-pressed={active.category === c.slug}
            className={chip(active.category === c.slug)}
          >
            {c.name}
          </Link>
        ))}
      </Row>

      <Row label={labels.status}>
        {STATUS.map((value) => (
          <Link
            key={value}
            href={href({ status: active.status === value ? undefined : value })}
            aria-pressed={active.status === value}
            className={chip(active.status === value)}
          >
            {labels[value]}
          </Link>
        ))}
        {LENGTH.map((value) => (
          <Link
            key={value}
            href={href({ length: active.length === value ? undefined : value })}
            aria-pressed={active.length === value}
            className={chip(active.length === value)}
          >
            {labels[value]}
          </Link>
        ))}
        {anyActive && (
          <Link href={localeHref(lang, `/search?q=${encodeURIComponent(q)}`)} className="px-2 py-1 text-sm text-muted underline-offset-4 hover:text-ink hover:underline">
            {labels.clear}
          </Link>
        )}
      </Row>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="hidden shrink-0 text-xs uppercase tracking-wide text-muted sm:inline">{label}</span>
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">{children}</div>
    </div>
  );
}
