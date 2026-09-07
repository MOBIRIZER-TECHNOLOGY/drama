import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CategoryBar } from "@/components/CategoryBar";
import { SeriesCard } from "@/components/SeriesCard";
import { buttonClass } from "@/components/ui/Button";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { localeHref } from "@/lib/languages";
import { fetchCategories, fetchLanguages, fetchSeriesList, fetchTranslations } from "@/lib/server-data";

export const revalidate = 60;

const PAGE_SIZE = 40;

function pageOffset(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const n = value && /^\d+$/.test(value) ? Number(value) : 0;
  return Math.min(Math.max(0, n), 10_000);
}

async function findCategory(slug: string) {
  return (await fetchCategories()).find((c) => c.slug === slug) ?? null;
}

export async function generateMetadata({ params }: PageProps<"/[lang]/category/[slug]">): Promise<Metadata> {
  const { lang, slug } = await params;
  const [category, messages, languages] = await Promise.all([findCategory(slug), fetchTranslations(lang), fetchLanguages()]);
  if (!category) notFound();
  const t = (key: string, fallback: string, vars?: Record<string, string>) => {
    let s = messages[key] || fallback;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
    return s;
  };
  const title = t("category.title", "{name} dramas", { name: category.name });
  const description = t("category.description", "Watch {name} short dramas on Katha.", { name: category.name });
  const path = `/category/${category.slug}`;
  return {
    title,
    description,
    alternates: {
      canonical: localeHref(lang, path),
      languages: Object.fromEntries(languages.map((l) => [l.code, localeHref(l.code, path)])),
    },
    openGraph: { title, description, type: "website", locale: lang },
  };
}

export default async function CategoryPage({ params, searchParams }: PageProps<"/[lang]/category/[slug]">) {
  const { lang, slug } = await params;
  const sp = await searchParams;
  const offset = pageOffset(sp.offset);

  const [category, categories, messages, result] = await Promise.all([
    findCategory(slug),
    fetchCategories(),
    fetchTranslations(lang),
    fetchSeriesList({ lang, category: slug, limit: PAGE_SIZE, offset }),
  ]);
  if (!category) notFound();
  const t = (key: string, fallback: string, vars?: Record<string, string | number>) => {
    let s = messages[key] || fallback;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };

  const items = result.ok ? result.data : [];
  // The endpoint returns a plain array: a full page means "there may be more".
  const hasNext = items.length === PAGE_SIZE;
  const path = `/category/${slug}`;
  const pageHref = (o: number) => localeHref(lang, o > 0 ? `${path}?offset=${o}` : path);

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <nav aria-label={t("common.breadcrumb", "Breadcrumb")} className="text-sm text-muted">
        <Link href={localeHref(lang, "/series")} className="hover:text-ink">
          {t("browse.title", "Browse all dramas")}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-ink2">{category.name}</span>
      </nav>
      <h1 className="mt-2 font-display text-2xl font-bold text-ink sm:text-3xl">{category.name}</h1>
      <div className="mt-5">
        <CategoryBar
          categories={categories}
          lang={lang}
          activeSlug={slug}
          allLabel={t("browse.all", "All")}
          label={t("browse.categories", "Categories")}
        />
      </div>

      <div className="mt-8">
        {!result.ok ? (
          <ErrorState
            title={t("browse.error_title", "We couldn't load the catalogue")}
            message={t("browse.error_message", "Please try again in a moment.")}
            retryLabel={t("common.retry", "Try again")}
          />
        ) : items.length === 0 ? (
          <EmptyState
            title={offset > 0 ? t("category.no_more", "No more dramas on this page") : t("category.empty_title", "Nothing here yet")}
            message={
              offset > 0
                ? t("category.no_more_hint", "Go back a page to see the rest.")
                : t("category.empty_message", "This category has no published dramas right now.")
            }
            action={
              offset > 0 ? (
                <Link href={pageHref(Math.max(0, offset - PAGE_SIZE))} className={buttonClass("secondary", "sm")}>
                  {t("common.previous", "Previous")}
                </Link>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {items.map((s, i) => (
                <SeriesCard
                  key={s.id}
                  series={s}
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
                  {t("common.page", "Page {n}", { n: Math.floor(offset / PAGE_SIZE) + 1 })}
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
    </div>
  );
}
