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
      // Deliberately parameterless. `?s=&ep=` makes the feed resumable and shareable; it must not become a
      // second indexable page competing with the episode page the share ultimately points at.
      canonical: localeHref(lang, "/shorts"),
      languages: Object.fromEntries(languages.map((l) => [l.code, localeHref(l.code, "/shorts")])),
    },
    openGraph: { title, description, type: "website", locale: lang },
  };
}

/** `?s=slug&ep=n` identifies one short in the feed. Anything malformed is ignored rather than 404'd. */
function parseStart(sp: Record<string, string | string[] | undefined>): { slug: string; episode: number } | null {
  const slug = Array.isArray(sp.s) ? sp.s[0] : sp.s;
  const raw = Array.isArray(sp.ep) ? sp.ep[0] : sp.ep;
  if (!slug || !raw || !/^\d{1,4}$/.test(raw)) return null;
  return { slug, episode: Number(raw) };
}

export default async function ShortsPage({ params, searchParams }: PageProps<"/[lang]/shorts">) {
  const { lang } = await params;
  const startAt = parseStart(await searchParams);
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

  return <ShortsFeed initial={items} nextCursor={nextCursor ?? null} lang={lang} startAt={startAt} />;
}
