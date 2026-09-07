import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/JsonLd";
import { Rail } from "@/components/Rail";
import { SeriesCard } from "@/components/SeriesCard";
import { SeriesView } from "@/components/series/SeriesView";
import { ErrorState } from "@/components/ui/states";
import { localeHref } from "@/lib/languages";
import { tvSeriesJsonLd, videoObjectJsonLd } from "@/lib/seo";
import { fetchLanguages, fetchSeries, fetchTranslations } from "@/lib/server-data";

/**
 * An episode as a real page.
 *
 * Episodes were reachable only as `?ep=N`, a query parameter Google will not index as a page — so the entire
 * episode long tail ("<series> episode 12 watch online"), the highest-volume query class in this category, was
 * uncrawlable, and the VideoObject JSON-LD pointed at a URL that would never be indexed.
 *
 * The page renders the same view as the series route with the episode selected, and declares the series page as
 * its canonical parent through `rel=up`-style breadcrumbs while keeping its own canonical, so both are indexable
 * without competing.
 */
function parseEpisode(raw: string): number | null {
  return /^\d{1,4}$/.test(raw) && Number(raw) > 0 ? Number(raw) : null;
}

export async function generateMetadata({ params }: PageProps<"/[lang]/series/[slug]/[episode]">): Promise<Metadata> {
  const { lang, slug, episode } = await params;
  const number = parseEpisode(episode);
  if (number == null) notFound();

  const [result, languages] = await Promise.all([fetchSeries(slug, lang), fetchLanguages()]);
  if (!result.ok && result.status === 404) notFound();
  if (!result.ok) return { title: "Episode" };

  const s = result.data;
  const ep = s.episodes.find((e) => e.number === number);
  if (!ep) notFound();

  const title = `${s.title} — Episode ${number}`;
  const description =
    ep.title || s.meta_description || s.synopsis || `Watch episode ${number} of ${s.title} on Katha.`;
  const path = `/series/${s.slug}/${number}`;
  return {
    title,
    description,
    alternates: {
      canonical: localeHref(lang, path),
      languages: Object.fromEntries(languages.map((l) => [l.code, localeHref(l.code, path)])),
    },
    openGraph: { title, description, type: "video.episode", siteName: "Katha", locale: lang },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function EpisodePage({ params }: PageProps<"/[lang]/series/[slug]/[episode]">) {
  const { lang, slug, episode } = await params;
  const number = parseEpisode(episode);
  if (number == null) notFound();

  const [result, messages] = await Promise.all([fetchSeries(slug, lang), fetchTranslations(lang)]);
  const t = (key: string, fallback: string) => messages[key] || fallback;

  if (!result.ok) {
    if (result.status === 404) notFound();
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <ErrorState
          title={t("series.error_title", "We couldn't load this drama")}
          message={t("series.error_message", "Please try again in a moment.")}
          retryLabel={t("common.retry", "Try again")}
        />
      </div>
    );
  }

  const series = result.data;
  const selected = series.episodes.find((e) => e.number === number);
  if (!selected) notFound();
  const video = videoObjectJsonLd(series, selected, lang);

  return (
    <div className="pb-10">
      <JsonLd data={video ? [tvSeriesJsonLd(series, lang), video] : tvSeriesJsonLd(series, lang)} />
      <SeriesView series={series} initialEpisode={number} />
      {series.similar.length > 0 && (
        <div className="mx-auto mt-6 max-w-[1400px]">
          <Rail title={t("series.similar", "You may also like")}>
            {series.similar.map((s) => (
              <SeriesCard key={s.id} series={s} lang={lang} episodesLabel={t("series.eps", "eps")} freeLabel={t("series.free", "Free")} />
            ))}
          </Rail>
        </div>
      )}
    </div>
  );
}
