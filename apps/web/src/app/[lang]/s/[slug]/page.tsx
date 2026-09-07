import { permanentRedirect } from "next/navigation";
import { localeHref } from "@/lib/languages";

/**
 * Short share link. The mobile app shares `katha.app/s/{slug}`, which had no route on the web at all, so every
 * link sent to a friend without the app installed reached the catch-all and 404'd — the organic loop was not
 * weak, it was broken.
 *
 * This resolves to the canonical series URL and keeps the query string, so an episode number and the campaign
 * parameters that identify the sharer survive the hop. A 308 rather than a rewrite, so the canonical page owns
 * the SEO and analytics see one URL for the series.
 */
export default async function ShortLink({ params, searchParams }: PageProps<"/[lang]/s/[slug]">) {
  const { lang, slug } = await params;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) query.append(key, item);
  }
  const suffix = query.size ? `?${query}` : "";
  permanentRedirect(`${localeHref(lang, `/series/${encodeURIComponent(slug)}`)}${suffix}`);
}
