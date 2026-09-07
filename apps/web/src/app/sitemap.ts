import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/api";
import { DEFAULT_LANG, SUPPORTED_LANGS, localeHref } from "@/lib/languages";
import { fetchSitemap } from "@/lib/server-data";

/** Rebuilt hourly; the feed is one call to GET /v1/sitemap. */
export const revalidate = 3600;

const STATIC_PATHS = ["/", "/series", "/shorts"];

function url(lang: string, path: string): string {
  return `${SITE_URL}${localeHref(lang, path)}`;
}

/** hreflang alternates for a path across every supported language (plus x-default on the default language). */
function alternates(path: string, langs: string[]): { languages: Record<string, string> } {
  const languages: Record<string, string> = {};
  for (const l of langs) languages[l] = url(l, path);
  languages["x-default"] = url(DEFAULT_LANG, path);
  return { languages };
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = STATIC_PATHS.map((path) => ({
    url: url(DEFAULT_LANG, path),
    lastModified: new Date(),
    changeFrequency: "daily" as const,
    priority: path === "/" ? 1 : 0.7,
    alternates: alternates(path, SUPPORTED_LANGS),
  }));

  const feed = await fetchSitemap();
  if (!feed.ok) return entries;

  for (const s of feed.data.series) {
    const path = `/series/${s.slug}`;
    // Every supported language has a route (titles fall back to the default translation), so all of them are listed.
    entries.push({
      url: url(DEFAULT_LANG, path),
      lastModified: new Date(s.updated_at),
      changeFrequency: "weekly",
      priority: 0.8,
      alternates: alternates(path, SUPPORTED_LANGS),
    });
  }
  for (const slug of feed.data.pages) {
    const path = `/p/${slug}`;
    entries.push({
      url: url(DEFAULT_LANG, path),
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.3,
      alternates: alternates(path, SUPPORTED_LANGS),
    });
  }
  return entries;
}
