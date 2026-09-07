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

export async function generateMetadata({ params }: PageProps<"/[lang]/series/[slug]">): Promise<Metadata> {
  const { lang, slug } = await params;
  const [result, languages] = await Promise.all([fetchSeries(slug, lang), fetchLanguages()]);
  // Crawlers receive blocking metadata, so a 404 here yields a real 404 status for unknown slugs.
  if (!result.ok && result.status === 404) notFound();
  if (!result.ok) return { title: "Series" };
  const s = result.data;
  const title = s.seo_title || s.title;
  const description = s.meta_description || s.synopsis || `Watch ${s.title} on Katha.`;
  const path = `/series/${s.slug}`;
  const images = s.cover_url ? [{ url: s.cover_url, width: 720, height: 1280, alt: s.title }] : [];
  return {
    title,
    description,
    alternates: {
      canonical: localeHref(lang, path),
      languages: Object.fromEntries(languages.map((l) => [l.code, localeHref(l.code, path)])),
    },
    openGraph: { title, description, type: "video.tv_show", images, siteName: "Katha", locale: lang },
    twitter: { card: "summary_large_image", title, description, images: images.map((i) => i.url) },
  };
}

export default async function SeriesPage({ params, searchParams }: PageProps<"/[lang]/series/[slug]">) {
  const { lang, slug } = await params;
  const sp = await searchParams;
  const epRaw = Array.isArray(sp.ep) ? sp.ep[0] : sp.ep;
  const initialEpisode = epRaw && /^\d+$/.test(epRaw) ? Number(epRaw) : null;

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
  // The episode the page opens on (?ep, else where the viewer left off, else the first one).
  const sorted = [...series.episodes].sort((a, b) => a.number - b.number);
  const wanted = initialEpisode ?? series.continue_episode_number ?? 1;
  const currentEpisode = sorted.find((e) => e.number === wanted) ?? sorted[0] ?? null;
  const video = currentEpisode ? videoObjectJsonLd(series, currentEpisode, lang) : null;

  return (
    <>
      <JsonLd data={video ? [tvSeriesJsonLd(series, lang), video] : tvSeriesJsonLd(series, lang)} />
      <SeriesView series={series} initialEpisode={initialEpisode} />
      {series.similar.length > 0 && (
        <div className="mx-auto mt-6 max-w-[1400px]">
          <Rail title={t("series.similar", "You may also like")}>
            {series.similar.map((s) => (
              <SeriesCard key={s.id} series={s} lang={lang} episodesLabel={t("series.eps", "eps")} freeLabel={t("series.free", "Free")} />
            ))}
          </Rail>
        </div>
      )}
    </>
  );
}
