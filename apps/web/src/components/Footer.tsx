import Link from "next/link";
import { localeHref } from "@/lib/languages";
import type { FooterLink } from "@/lib/types";

export function Footer({
  lang,
  pages,
  contactLabel,
  tagline,
}: {
  lang: string;
  pages: FooterLink[];
  contactLabel: string;
  tagline: string;
}) {
  return (
    <footer className="mt-16 border-t border-line">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-start md:justify-between lg:px-8">
        <div>
          <p className="font-display text-xl font-bold text-ink">
            Katha<span className="text-accent">.</span>
          </p>
          <p className="mt-1 max-w-xs text-sm text-muted">{tagline}</p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {pages.map((p) => (
            <Link key={p.slug} href={localeHref(lang, `/p/${p.slug}`)} className="text-ink2 hover:text-ink">
              {p.title}
            </Link>
          ))}
          <Link href={localeHref(lang, "/contact")} className="text-ink2 hover:text-ink">
            {contactLabel}
          </Link>
        </nav>
      </div>
      <div className="border-t border-line py-4 text-center text-xs text-muted">© {new Date().getFullYear()} Katha</div>
    </footer>
  );
}
