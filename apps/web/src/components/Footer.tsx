import Link from "next/link";
import { localeHref } from "@/lib/languages";
import type { CategoryOut, FooterLink, LanguageOut } from "@/lib/types";

/**
 * The footer is the best internal-linking surface a catalogue site has, and it was four CMS links in a flat
 * ribbon: no genre links, no language list, no company entity, nothing for a crawler to follow and nothing for
 * a payment processor's onboarding review to find.
 *
 * Columns rather than a wrap, because with eight CMS pages the ribbon became unreadable.
 */
export function Footer({
  lang,
  pages,
  categories,
  languages,
  contactLabel,
  tagline,
  labels,
}: {
  lang: string;
  pages: FooterLink[];
  categories: CategoryOut[];
  languages: LanguageOut[];
  contactLabel: string;
  tagline: string;
  labels: { browse: string; watch: string; company: string; languages: string; shorts: string; rewards: string };
}) {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-16 border-t border-line">
      <div className="mx-auto grid max-w-[1400px] gap-8 px-4 py-10 sm:px-6 md:grid-cols-4 lg:px-8">
        <div className="md:col-span-1">
          <p className="font-display text-xl font-bold text-ink">
            Katha<span className="text-accent">.</span>
          </p>
          <p className="mt-1 max-w-xs text-sm text-muted">{tagline}</p>
        </div>

        {categories.length > 0 && (
          <nav aria-label={labels.browse}>
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted">{labels.browse}</h2>
            <ul className="mt-3 flex flex-col gap-2 text-sm">
              {categories.slice(0, 8).map((c) => (
                <li key={c.id}>
                  <Link href={localeHref(lang, `/category/${c.slug}`)} className="text-ink2 hover:text-ink">
                    {c.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <nav aria-label={labels.watch}>
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted">{labels.watch}</h2>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            <li>
              <Link href={localeHref(lang, "/series")} className="text-ink2 hover:text-ink">
                {labels.browse}
              </Link>
            </li>
            <li>
              <Link href={localeHref(lang, "/shorts")} className="text-ink2 hover:text-ink">
                {labels.shorts}
              </Link>
            </li>
            <li>
              <Link href={localeHref(lang, "/rewards")} className="text-ink2 hover:text-ink">
                {labels.rewards}
              </Link>
            </li>
          </ul>
        </nav>

        <nav aria-label={labels.company}>
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted">{labels.company}</h2>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {pages.map((p) => (
              <li key={p.slug}>
                <Link href={localeHref(lang, `/p/${p.slug}`)} className="text-ink2 hover:text-ink">
                  {p.title}
                </Link>
              </li>
            ))}
            <li>
              <Link href={localeHref(lang, "/contact")} className="text-ink2 hover:text-ink">
                {contactLabel}
              </Link>
            </li>
          </ul>
        </nav>
      </div>

      {/* Every language gets a crawlable link, which is also how a viewer who landed in the wrong one escapes. */}
      {languages.length > 1 && (
        <div className="border-t border-line">
          <nav aria-label={labels.languages} className="mx-auto flex max-w-[1400px] flex-wrap gap-x-4 gap-y-2 px-4 py-3 text-xs sm:px-6 lg:px-8">
            <span className="text-muted">{labels.languages}:</span>
            {languages.map((l) => (
              <Link
                key={l.code}
                href={localeHref(l.code, "/")}
                hrefLang={l.code}
                className={l.code === lang ? "font-medium text-ink" : "text-ink2 hover:text-ink"}
              >
                {l.native_name || l.name}
              </Link>
            ))}
          </nav>
        </div>
      )}

      <div className="border-t border-line py-4 text-center text-xs text-muted">© {year} Katha</div>
    </footer>
  );
}
