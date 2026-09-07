import type { Metadata } from "next";
import { ShortsFeed } from "@/components/shorts/ShortsFeed";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { localeHref } from "@/lib/languages";
import { fetchLanguages, fetchShorts, fetchTranslations } from "@/lib/server-data";

export const revalidate = 60;

export async function generateMetadata({ params }: PageProps<"/[lang]/shorts">): Promise<Metadata> {
  const { lang } = await params;
  const [messages, languages] = await Promise.all([fetchTranslations(lang), fetchLanguages()]);
  const t = (key: string, fallback: string) => messages[key] || fallback;
  const title = t("shorts.title", "Shorts");
  const description = t("shorts.description", "Binge vertical dramas one episode at a time.");
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
  const [feed, messages] = await Promise.all([fetchShorts(lang), fetchTranslations(lang)]);
  const t = (key: string, fallback: string) => messages[key] || fallback;

  if (!feed.ok) {
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

  const { items, next_cursor: nextCursor } = feed.data;

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

  return <ShortsFeed initial={items} nextCursor={nextCursor ?? null} lang={lang} />;
}
