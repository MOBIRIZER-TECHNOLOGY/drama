import Link from "next/link";
import { localeHref } from "@/lib/languages";
import type { Crumb } from "@/lib/seo";

/**
 * The visible trail that matches the BreadcrumbList in the page's structured data.
 *
 * Two jobs: it tells a viewer who arrived from search where they are and gives them one click up into the
 * catalogue — previously the only way out of an episode page was the browser's Back button — and it creates the
 * internal links that make category and browse pages reachable from the deep pages that earn the traffic.
 */
export function Breadcrumbs({ crumbs, lang, label }: { crumbs: Crumb[]; lang: string; label: string }) {
  if (crumbs.length < 2) return null;
  return (
    <nav aria-label={label} className="mb-3 flex flex-wrap items-center gap-x-2 text-sm text-muted">
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        return (
          <span key={`${c.name}-${i}`} className="flex items-center gap-2">
            {c.path && !last ? (
              <Link href={localeHref(lang, c.path)} className="underline-offset-4 hover:text-ink hover:underline">
                {c.name}
              </Link>
            ) : (
              <span className={last ? "truncate text-ink2" : undefined} aria-current={last ? "page" : undefined}>
                {c.name}
              </span>
            )}
            {!last && <span aria-hidden>/</span>}
          </span>
        );
      })}
    </nav>
  );
}
