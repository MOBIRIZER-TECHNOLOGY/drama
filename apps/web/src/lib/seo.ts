import { SITE_URL } from "./api";
import { localeHref } from "./languages";
import type { EpisodeOut, SeriesDetail } from "./types";

/** Absolute URL for a language-prefixed path. */
export function absoluteUrl(lang: string, path: string): string {
  return `${SITE_URL}${localeHref(lang, path)}`;
}

/** schema.org TVSeries for a series page. */
export function tvSeriesJsonLd(series: SeriesDetail, lang: string): Record<string, unknown> {
  const url = absoluteUrl(lang, `/series/${series.slug}`);
  return {
    "@context": "https://schema.org",
    "@type": "TVSeries",
    name: series.title,
    url,
    numberOfEpisodes: series.episode_count,
    inLanguage: lang,
    ...(series.cover_url ? { image: series.cover_url } : {}),
    ...(series.meta_description || series.synopsis ? { description: series.meta_description || series.synopsis } : {}),
    ...(series.categories.length ? { genre: series.categories.map((c) => c.name) } : {}),
    ...(series.released_at ? { datePublished: series.released_at.slice(0, 10) } : {}),
    ...(series.like_count > 0
      ? { interactionStatistic: { "@type": "InteractionCounter", interactionType: "https://schema.org/LikeAction", userInteractionCount: series.like_count } }
      : {}),
  };
}

/** schema.org VideoObject for one episode. Only emitted when the episode has a thumbnail (Google requires one). */
export function videoObjectJsonLd(series: SeriesDetail, episode: EpisodeOut, lang: string): Record<string, unknown> | null {
  const thumbnail = episode.thumbnail_url;
  if (!thumbnail) return null;
  // The episode's own page, not `?ep=N`: a query parameter is not indexed as a page, so the whole episode
  // long tail was invisible and this payload described a URL that would never rank.
  const url = absoluteUrl(lang, `/series/${series.slug}/${episode.number}`);
  return {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: episode.title ? `${series.title} – ${episode.title}` : `${series.title} – Episode ${episode.number}`,
    description: series.meta_description || series.synopsis || series.title,
    thumbnailUrl: [thumbnail],
    uploadDate: series.released_at ?? undefined,
    inLanguage: lang,
    ...(episode.duration_sec ? { duration: `PT${Math.max(1, Math.round(episode.duration_sec))}S` } : {}),
    url,
    isPartOf: { "@type": "TVSeries", name: series.title, url: absoluteUrl(lang, `/series/${series.slug}`) },
    potentialAction: { "@type": "WatchAction", target: url },
  };
}

/** schema.org WebSite with a SearchAction for the home page. */
export function webSiteJsonLd(lang: string, siteName: string): Record<string, unknown> {
  const home = absoluteUrl(lang, "/");
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: siteName,
    url: home,
    inLanguage: lang,
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${absoluteUrl(lang, "/search")}?q={search_term_string}` },
      "query-input": "required name=search_term_string",
    },
  };
}
