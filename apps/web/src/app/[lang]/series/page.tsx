import type { Metadata } from "next";
import Link from "next/link";
import { CategoryBar } from "@/components/CategoryBar";
import { Rail } from "@/components/Rail";
import { SeriesCard } from "@/components/SeriesCard";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { localeHref } from "@/lib/languages";
import { fetchCategories, fetchLanguages, fetchSeriesList, fetchTranslations } from "@/lib/server-data";
import type { SeriesCard as SeriesCardT } from "@/lib/types";

/** Catalogue pages are cached per language and refreshed in the background every minute. */
export const revalidate = 60;

const PER_CATEGORY = 12;

export async function generateMetadata({ params }: PageProps<"/[lang]/series">): Promise<Metadata> {
  const { lang } = await params;
  const [messages, languages] = await Promise.all([fetchTranslations(lang), fetchLanguages()]);
  const t = (key: string, fallback: string) => messages[key] || fallback;
  const title = t("browse.title", "Browse all dramas");
  const description = t("browse.description", "Every Katha series, grouped by category. New episodes every week.");
  return {
    title,
    description,
    alternates: {
      canonical: localeHref(lang, "/series"),
      languages: Object.fromEntries(languages.map((l) => [l.code, localeHref(l.code, "/series")])),
    },
    openGraph: { title, description, type: "website", locale: lang },
  };
}

export default async function BrowsePage({ params }: PageProps<"/[lang]/series">) {
  const { lang } = await params;
  const [categories, messages, all] = await Promise.all([
    fetchCategories(),
    fetchTranslations(lang),
    fetchSeriesList({ lang, limit: 100 }),
  ]);
  const t = (key: string, fallback: string) => messages[key] || fallback;

  // One request per category keeps the grouping honest (a series can sit in several categories).
  const groups = await Promise.all(
    categories.map(async (c) => ({
      category: c,
      result: await fetchSeriesList({ lang, category: c.slug, limit: PER_CATEGORY }),
    })),
  );
  const filled = groups.filter((g) => g.result.ok && g.result.data.length > 0) as {
    category: (typeof categories)[number];
    result: { ok: true; data: SeriesCardT[] };
  }[];

  const uncategorised = all.ok ? all.data.filter((s) => s.categories.length === 0) : [];
  const failed = !all.ok && filled.length === 0;

  return (
    <div className="mx-auto max-w-[1400px] py-6 sm:py-8">
      <div className="px-4 sm:px-6 lg:px-8">
        <h1 className="font-display text-2xl font-bold text-ink sm:text-3xl">{t("browse.title", "Browse all dramas")}</h1>
        <p className="mt-1 text-sm text-muted">{t("browse.subtitle", "Pick a category, or scroll the whole catalogue.")}</p>
        <div className="mt-5">
          <CategoryBar
            categories={categories}
            lang={lang}
            activeSlug={null}
            allLabel={t("browse.all", "All")}
            label={t("browse.categories", "Categories")}
          />
        </div>
      </div>

      {failed ? (
        <div className="mx-auto mt-10 max-w-lg px-4">
          <ErrorState
            title={t("browse.error_title", "We couldn't load the catalogue")}
            message={t("browse.error_message", "Please try again in a moment.")}
            retryLabel={t("common.retry", "Try again")}
          />
        </div>
      ) : filled.length === 0 && uncategorised.length === 0 ? (
        <div className="mx-auto mt-10 max-w-lg px-4">
          <EmptyState
            title={t("browse.empty_title", "Nothing published yet")}
            message={t("browse.empty_message", "New dramas are on their way. Check back soon.")}
          />
        </div>
      ) : (
        <div className="mt-8 flex flex-col gap-10">
          {filled.map(({ category, result }) => (
            <Rail
              key={category.id}
              id={`category-${category.slug}`}
              title={category.name}
              action={
                <Link href={localeHref(lang, `/category/${category.slug}`)} className="text-sm font-medium text-accent hover:underline">
                  {t("browse.see_all", "See all")}
                </Link>
              }
            >
              {result.data.map((s) => (
                <SeriesCard key={s.id} series={s} lang={lang} episodesLabel={t("series.eps", "eps")} freeLabel={t("series.free", "Free")} />
              ))}
            </Rail>
          ))}
          {uncategorised.length > 0 && (
            <Rail title={t("browse.more", "More on Katha")}>
              {uncategorised.map((s) => (
                <SeriesCard key={s.id} series={s} lang={lang} episodesLabel={t("series.eps", "eps")} freeLabel={t("series.free", "Free")} />
              ))}
            </Rail>
          )}
        </div>
      )}
    </div>
  );
}
