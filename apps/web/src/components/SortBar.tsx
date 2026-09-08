import Link from "next/link";

export const SORTS = ["featured", "popular", "newest", "updated"] as const;
export type Sort = (typeof SORTS)[number];

export function isSort(value: string | undefined): value is Sort {
  return !!value && (SORTS as readonly string[]).includes(value);
}

/**
 * How the catalogue is ordered.
 *
 * The editorial weighting was the only order a visitor could have: someone looking for what is popular, or
 * what landed this week, had no way to ask. Rendered as links rather than a select so the orderings are
 * crawlable and shareable — and so the control works before any JavaScript arrives, which on the connections
 * this audience is on is most of the time it matters.
 *
 * Non-default orders keep the unsorted URL as their canonical, so the same catalogue does not compete with
 * itself in search.
 */
export function SortBar({
  active,
  hrefFor,
  labels,
  label,
}: {
  active: Sort;
  /** Builds the URL for one ordering; the caller owns the rest of the query string. */
  hrefFor: (sort: Sort) => string;
  labels: Record<Sort, string>;
  label: string;
}) {
  return (
    <nav aria-label={label} className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      {SORTS.map((sort) => {
        const current = sort === active;
        return (
          <Link
            key={sort}
            href={hrefFor(sort)}
            aria-current={current ? "true" : undefined}
            scroll={false}
            className={`whitespace-nowrap rounded-pill px-3 py-1.5 text-sm transition-colors ${
              current ? "bg-surface2 font-medium text-ink" : "text-muted hover:text-ink"
            }`}
          >
            {labels[sort]}
          </Link>
        );
      })}
    </nav>
  );
}
