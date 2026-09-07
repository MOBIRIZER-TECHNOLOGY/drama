import type { Metadata } from "next";
import { ShortsFeed } from "@/components/shorts/ShortsFeed";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { localeHref } from "@/lib/languages";
import { fetchHome, fetchLanguages, fetchTranslations } from "@/lib/server-data";
import type { SeriesCard } from "@/lib/types";

export const revalidate = 60;

/** Rails the feed is built from, in order. */
const FEED_RAILS = ["featured", "top_picks", "newest"];

export async function generateMetadata({ params }: PageProps<"/[lang]/shorts">): Promise<Metadata> {
  const { lang } = await params;
  const [messages, languages] = await Promise.all([fetchTranslations(lang), fetchLanguages()]);
  const t = (key: string, fallback: string) => messages[key] || fallback;
  const title = t("shorts.title", "Shorts");
  const description = t("shorts.description", "Swipe through the first episode of every drama.");
  return {
    title,
    description,
    alternates: {
      canonical: localeHref(lang, "/shorts"),
      languages: Object.fromEntries(languages.map((l) => [l.code, localeHref(l.code, "/shorts")])),
    },
    openGraph: { title, description, type: "website", locale: lang },
  };
}

export default async function ShortsPage({ params }: PageProps<"/[lang]/shorts">) {
  const { lang } = await params;
  const [home, messages] = await Promise.all([fetchHome(lang), fetchTranslations(lang)]);
  const t = (key: string, fallback: string) => messages[key] || fallback;

  if (!home.ok) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <ErrorState
          title={t("shorts.error_title", "We couldn't load Shorts")}
          message={t("home.error_message", "The catalogue is taking a moment. Please try again.")}
          retryLabel={t("common.retry", "Try again")}
        />
      </div>
    );
  }

  // One card per series, in rail order; cards without a first episode cannot be played here.
  const seen = new Set<string>();
  const items: SeriesCard[] = [];
  for (const key of FEED_RAILS) {
    const rail = home.data.rails.find((r) => r.key === key);
    for (const card of rail?.items ?? []) {
      if (!card.first_episode_id || seen.has(card.id)) continue;
      seen.add(card.id);
      items.push(card);
    }
  }

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <EmptyState
          title={t("shorts.empty_title", "No shorts yet")}
          message={t("shorts.empty_message", "New dramas are on their way. Check back soon.")}
        />
      </div>
    );
  }

  return <ShortsFeed items={items} />;
}
