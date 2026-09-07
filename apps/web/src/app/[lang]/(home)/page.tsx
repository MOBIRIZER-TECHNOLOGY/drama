import { HeroCarousel } from "@/components/HeroCarousel";
import { JsonLd } from "@/components/JsonLd";
import { LandingIntro } from "@/components/LandingIntro";
import { PersonalRails } from "@/components/PersonalRails";
import { Rail } from "@/components/Rail";
import { SeriesCard } from "@/components/SeriesCard";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { webSiteJsonLd } from "@/lib/seo";
import { fetchHome, fetchTranslations } from "@/lib/server-data";

/** Catalogue pages are cached per language and refreshed in the background every minute. */
export const revalidate = 60;

export default async function HomePage({ params }: PageProps<"/[lang]">) {
  const { lang } = await params;
  const [home, messages] = await Promise.all([fetchHome(lang), fetchTranslations(lang)]);
  const t = (key: string, fallback: string) => messages[key] || fallback;

  if (!home.ok) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <ErrorState
          title={t("home.error_title", "We couldn't load the home page")}
          message={t("home.error_message", "The catalogue is taking a moment. Please try again.")}
          retryLabel={t("common.retry", "Try again")}
        />
      </div>
    );
  }

  // `continue` and `for_you` are per-user: this response is the cached anonymous one, so PersonalRails fetches them.
  const rails = home.data.rails.filter((r) => r.items.length > 0 && r.key !== "continue" && r.key !== "for_you");
  const featured = rails.find((r) => r.key === "featured") ?? null;
  const heroItems = featured?.items ?? rails.flatMap((r) => r.items).filter((s) => s.is_featured).slice(0, 6);
  const others = rails.filter((r) => r !== featured);

  if (rails.length === 0) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <EmptyState
          title={t("home.empty_title", "Nothing to watch yet")}
          message={t("home.empty_message", "New dramas are on their way. Check back soon.")}
        />
      </div>
    );
  }

  return (
    <div className="pb-8">
      <JsonLd data={webSiteJsonLd(lang, t("meta.site_name", "Katha"))} />
      {/* What Katha is — shown to anonymous visitors only. Returning viewers want their rails, not a pitch. */}
      <LandingIntro />
      {heroItems.length > 0 && (
        <div className="pt-0 sm:pt-6">
          <HeroCarousel items={heroItems.slice(0, 8)} />
        </div>
      )}
      <div className="mx-auto mt-8 flex max-w-[1400px] flex-col gap-10 sm:mt-10">
        <PersonalRails />
        {others.map((rail) => {
          // The catalogue's own ordering is already a ranking, so `top_picks` renders numbered. A ranked row is
          // the highest-CTR rail format in this category and it cost one prop.
          const ranked = rail.key === "top_picks";
          return (
            <Rail
              key={rail.key}
              title={ranked ? t("home.top_10", "Top 10 this week") : rail.title}
              id={`rail-${rail.key}`}
            >
              {(ranked ? rail.items.slice(0, 10) : rail.items).map((s, i) => (
                <SeriesCard
                  key={s.id}
                  series={s}
                  lang={lang}
                  rank={ranked ? i + 1 : undefined}
                  episodesLabel={t("series.eps", "eps")}
                  freeLabel={t("series.free", "Free")}
                />
              ))}
            </Rail>
          );
        })}
        {others.length === 0 && featured && (
          <Rail title={featured.title}>
            {featured.items.map((s) => (
              <SeriesCard key={s.id} series={s} lang={lang} episodesLabel={t("series.eps", "eps")} freeLabel={t("series.free", "Free")} />
            ))}
          </Rail>
        )}
      </div>
    </div>
  );
}
