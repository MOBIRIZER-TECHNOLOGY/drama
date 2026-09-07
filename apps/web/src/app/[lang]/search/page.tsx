import type { Metadata } from "next";
import { Beacon } from "@/components/Beacon";
import { SeriesCard } from "@/components/SeriesCard";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { fetchTranslations, searchSeries } from "@/lib/server-data";

export const metadata: Metadata = { title: "Search", robots: { index: false } };

export default async function SearchPage({ params, searchParams }: PageProps<"/[lang]/search">) {
  const { lang } = await params;
  const sp = await searchParams;
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.trim() ?? "";
  const messages = await fetchTranslations(lang);
  const t = (key: string, fallback: string) => messages[key] || fallback;
  const result = q ? await searchSeries(q, lang) : null;

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 lg:px-8">
      {q && <Beacon key={q} name="search" props={{ q, results: result?.ok ? result.data.length : null, surface: "page" }} />}
      <h1 className="font-display text-2xl font-bold text-ink sm:text-3xl">
        {q ? (
          <>
            {t("search.results_for", "Results for")} <span className="text-accent">“{q}”</span>
          </>
        ) : (
          t("search.label", "Search")
        )}
      </h1>
      <div className="mt-6">
        {!q ? (
          <EmptyState title={t("search.empty_title", "Type something to search")} message={t("search.empty_message", "Try a title, a genre or a mood.")} />
        ) : !result?.ok ? (
          <ErrorState message={t("search.error", "Search is unavailable right now.")} retryLabel={t("common.retry", "Try again")} />
        ) : result.data.length === 0 ? (
          <EmptyState title={t("search.no_results", "No dramas match that.")} message={t("search.no_results_hint", "Check the spelling or try a broader term.")} />
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
