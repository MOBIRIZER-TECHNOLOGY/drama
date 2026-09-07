import Link from "next/link";
import { lang as rootLang } from "next/root-params";
import { SearchBox } from "@/components/SearchBox";
import { SeriesCard } from "@/components/SeriesCard";
import { buttonClass } from "@/components/ui/Button";
import { DEFAULT_LANG, isSupportedLang, localeHref } from "@/lib/languages";
import { fetchHome, fetchTranslations } from "@/lib/server-data";

/**
 * Most 404s here come from expired or mistyped share links, which is the highest-intent traffic the site gets:
 * someone was sent a specific drama. Offering only "Back to home" recovers nobody, so this gives them the
 * search box and a rail of things to watch instead of a dead end.
 */
export default async function NotFound() {
  const current = (await rootLang()) ?? DEFAULT_LANG;
  const lang = isSupportedLang(current) ? current : DEFAULT_LANG;
  const [messages, home] = await Promise.all([fetchTranslations(lang), fetchHome(lang)]);
  const t = (key: string, fallback: string) => messages[key] || fallback;

  const popular = home.ok
    ? (home.data.rails.find((r) => r.key === "top_picks") ?? home.data.rails.find((r) => r.items.length > 0))?.items.slice(0, 6) ?? []
    : [];

  return (
    <div className="mx-auto max-w-4xl px-4 py-16">
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="font-display text-3xl font-bold text-accent">404</p>
        <h1 className="font-display text-2xl font-semibold text-ink">{t("not_found.title", "This page is missing")}</h1>
        <p className="max-w-md text-sm text-muted">
          {t("not_found.message", "The link may have expired, or the drama may no longer be published. Try searching for it.")}
        </p>
        <div className="mt-2 w-full max-w-md">
          <SearchBox />
        </div>
        <div className="mt-1 flex flex-wrap justify-center gap-2">
          <Link href={localeHref(lang, "/series")} className={buttonClass("primary")}>
            {t("not_found.browse", "Browse all dramas")}
          </Link>
          <Link href={localeHref(lang, "/")} className={buttonClass("secondary")}>
            {t("not_found.home", "Back to home")}
          </Link>
        </div>
      </div>

      {popular.length > 0 && (
        <section className="mt-12" aria-labelledby="nf-popular">
          <h2 id="nf-popular" className="font-display mb-3 text-lg font-semibold text-ink">
            {t("not_found.popular", "Popular right now")}
          </h2>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
            {popular.map((s) => (
              <SeriesCard
                key={s.id}
                series={s}
                lang={lang}
                className="w-full sm:w-full md:w-full"
                episodesLabel={t("series.eps", "eps")}
                freeLabel={t("series.free", "Free")}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
