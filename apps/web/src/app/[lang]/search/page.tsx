import type { Metadata } from "next";
import { Beacon } from "@/components/Beacon";
import { SeriesCard } from "@/components/SeriesCard";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SearchFacets, type Facets } from "@/components/SearchFacets";
import { SearchSuggestions } from "@/components/SearchSuggestions";
import { fetchCategories, fetchTranslations, searchSeries, type SearchFilters } from "@/lib/server-data";

const STATUSES = ["completed", "ongoing"] as const;
const LENGTHS = ["short", "medium", "long"] as const;

/** One value from a known set, or undefined. Anything else in the URL is ignored rather than 404'd. */
function pick<T extends string>(raw: string | string[] | undefined, allowed: readonly T[]): T | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return allowed.includes(value as T) ? (value as T) : undefined;
}

export const metadata: Metadata = { title: "Search", robots: { index: false } };

export default async function SearchPage({ params, searchParams }: PageProps<"/[lang]/search">) {
  const { lang } = await params;
  const sp = await searchParams;
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.trim() ?? "";
  const [messages, categories] = await Promise.all([fetchTranslations(lang), fetchCategories(lang)]);
  const t = (key: string, fallback: string) => messages[key] || fallback;

  const category = Array.isArray(sp.category) ? sp.category[0] : sp.category;
  const filters: SearchFilters = {
    category: categories.some((c) => c.slug === category) ? category : undefined,
    status: pick(sp.status, STATUSES),
    length: pick(sp.length, LENGTHS),
  };
  const active: Facets = { category: filters.category, status: filters.status, length: filters.length };
  const narrowed = Boolean(filters.category || filters.status || filters.length);
  const result = q ? await searchSeries(q, lang, filters) : null;

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 lg:px-8">
      {q && <Beacon key={q} name="search" remember={q} props={{ q, results: result?.ok ? result.data.length : null, surface: "page" }} />}
      <h1 className="font-display text-2xl font-bold text-ink sm:text-3xl">
        {q ? (
          <>
            {t("search.results_for", "Results for")} <span className="text-accent">“{q}”</span>
          </>
        ) : (
          t("search.label", "Search")
        )}
      </h1>
      {q && (
        <div className="mt-5">
          <SearchFacets
            q={q}
            lang={lang}
            active={active}
            categories={categories.slice(0, 12)}
            labels={{
              group: t("search.filters", "Filters"),
              genre: t("search.genre", "Genre"),
              status: t("search.status", "Status"),
              length: t("search.length", "Length"),
              any: t("search.any", "Any"),
              completed: t("search.completed", "Completed"),
              ongoing: t("search.ongoing", "Ongoing"),
              short: t("search.short", "Under 20 eps"),
              medium: t("search.medium", "20–60 eps"),
              long: t("search.long", "60+ eps"),
              clear: t("search.clear_filters", "Clear filters"),
            }}
          />
        </div>
      )}
      <div className="mt-6">
        {!q ? (
          // "Type something to search" was a blank wall on the highest-intent screen in the product.
          <SearchSuggestions categories={categories.slice(0, 12)} />
        ) : !result?.ok ? (
          <ErrorState message={t("search.error", "Search is unavailable right now.")} retryLabel={t("common.retry", "Try again")} />
        ) : result.data.length === 0 ? (
          <EmptyState
            title={t("search.no_results", "No dramas match that.")}
            // Two different dead ends: a query nothing matches, and filters that excluded everything. Telling
            // someone to check their spelling when the problem is a filter they set sends them the wrong way.
            message={
              narrowed
                ? t("search.no_results_filtered", "Nothing matches with these filters. Try clearing one.")
                : t("search.no_results_hint", "Check the spelling or try a broader term.")
            }
          />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {result.data.map((s) => (
              <SeriesCard key={s.id} series={s} lang={lang} className="w-full sm:w-full md:w-full" episodesLabel={t("series.eps", "eps")} freeLabel={t("series.free", "Free")} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
