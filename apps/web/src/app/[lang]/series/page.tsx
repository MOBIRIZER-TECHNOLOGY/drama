import type { Metadata } from "next";
import Link from "next/link";
import { CategoryBar } from "@/components/CategoryBar";
import { Rail } from "@/components/Rail";
import { SeriesCard } from "@/components/SeriesCard";
import { isSort, SortBar, type Sort } from "@/components/SortBar";
import { buttonClass } from "@/components/ui/Button";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { localeHref } from "@/lib/languages";
import { fetchBrowse, fetchCategories, fetchLanguages, fetchSeriesList, fetchTranslations } from "@/lib/server-data";

const PAGE_SIZE = 60;

/** Catalogue pages are cached per language and refreshed in the background every minute. */
export const revalidate = 60;

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

export default async function BrowsePage({ params, searchParams }: PageProps<"/[lang]/series">) {
  const { lang } = await params;
  const sp = await searchParams;
  const sortParam = Array.isArray(sp.sort) ? sp.sort[0] : sp.sort;
  /**
   * Ordering turns this page from a curated set of rails into a flat catalogue.
   *
   * Grouped rails are the right default — they are how someone browses without a goal — but a visitor who
   * wants "what is most watched" or "what landed this week" had no way to ask, and reordering rails would not
   * have answered it. Asking for an order asks for a list.
   */
  const sort: Sort | null = isSort(sortParam) ? sortParam : null;
  const offsetRaw = Array.isArray(sp.offset) ? sp.offset[0] : sp.offset;
  const offset = offsetRaw && /^\d+$/.test(offsetRaw) ? Math.min(Number(offsetRaw), 10_000) : 0;

  const [categories, messages, browse, flat] = await Promise.all([
    fetchCategories(lang),
    fetchTranslations(lang),
    // One request for the grouped view. This used to fetch the catalogue and then make another call per
    // category — 1 + N round trips on every revalidation, which was most of the page's time to first byte.
    sort ? Promise.resolve(null) : fetchBrowse(lang),
    sort ? fetchSeriesList({ lang, sort, limit: PAGE_SIZE, offset }) : Promise.resolve(null),
  ]);
  const t = (key: string, fallback: string) => messages[key] || fallback;

  const rails = browse?.ok ? browse.data.rails.filter((r) => r.items.length > 0) : [];
  const flatItems = flat?.ok ? flat.data : [];
  const failed = sort ? !flat?.ok : !browse?.ok;

  const hrefFor = (s: Sort) => localeHref(lang, s === "featured" ? "/series" : `/series?sort=${s}`);
  const pageHref = (o: number) =>
    localeHref(lang, `/series?sort=${sort ?? "featured"}${o > 0 ? `&offset=${o}` : ""}`);
  const hasNext = flatItems.length === PAGE_SIZE;

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
        <div className="mt-4">
          <SortBar
            active={sort ?? "featured"}
            hrefFor={hrefFor}
            label={t("browse.sort", "Sort")}
            labels={{
              featured: t("browse.sort_featured", "Featured"),
              popular: t("browse.sort_popular", "Most watched"),
              newest: t("browse.sort_newest", "Newest"),
              updated: t("browse.sort_updated", "Recently updated"),
            }}
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
      ) : sort ? (
        <div className="mt-8 px-4 sm:px-6 lg:px-8">
          {flatItems.length === 0 ? (
            <EmptyState
              title={offset > 0 ? t("browse.no_more", "Nothing more to show") : t("browse.empty_title", "Nothing published yet")}
              message={offset > 0 ? t("browse.no_more_hint", "Go back a page.") : t("browse.empty_message", "New dramas are on their way. Check back soon.")}
            />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {flatItems.map((series, i) => (
                  <SeriesCard
                    key={series.id}
                    series={series}
                    lang={lang}
                    priority={i < 6}
                    className="w-full sm:w-full md:w-full"
                    episodesLabel={t("series.eps", "eps")}
                    freeLabel={t("series.free", "Free")}
                  />
                ))}
              </div>
              {(offset > 0 || hasNext) && (
                <nav aria-label={t("common.pagination", "Pagination")} className="mt-8 flex items-center justify-between gap-3">
                  {offset > 0 ? (
                    <Link href={pageHref(Math.max(0, offset - PAGE_SIZE))} rel="prev" className={buttonClass("secondary")}>
                      {t("common.previous", "Previous")}
                    </Link>
                  ) : (
                    <span />
                  )}
                  <span className="text-sm text-muted">
                    {`${t("common.page_label", "Page")} ${Math.floor(offset / PAGE_SIZE) + 1}`}
                  </span>
                  {hasNext ? (
                    <Link href={pageHref(offset + PAGE_SIZE)} rel="next" className={buttonClass("secondary")}>
                      {t("common.next", "Next")}
                    </Link>
                  ) : (
                    <span />
                  )}
                </nav>
              )}
            </>
          )}
        </div>
      ) : rails.length === 0 ? (
        <div className="mx-auto mt-10 max-w-lg px-4">
          <EmptyState
            title={t("browse.empty_title", "Nothing published yet")}
            message={t("browse.empty_message", "New dramas are on their way. Check back soon.")}
          />
        </div>
      ) : (
        <div className="mt-8 flex flex-col gap-10">
          {rails.map((rail) => {
            // Rail keys are "category:<slug>" or "uncategorised"; only a real category gets a See all link.
            const slug = rail.key.startsWith("category:") ? rail.key.slice("category:".length) : null;
            return (
              <Rail
                key={rail.key}
                id={slug ? `category-${slug}` : rail.key}
                title={rail.title}
                action={
                  slug ? (
                    <Link href={localeHref(lang, `/category/${slug}`)} className="text-sm font-medium text-accent hover:underline">
                      {t("browse.see_all", "See all")}
                    </Link>
                  ) : undefined
                }
              >
                {rail.items.map((s) => (
                  <SeriesCard key={s.id} series={s} lang={lang} episodesLabel={t("series.eps", "eps")} freeLabel={t("series.free", "Free")} />
                ))}
              </Rail>
            );
          })}
        </div>
      )}
    </div>
  );
}
