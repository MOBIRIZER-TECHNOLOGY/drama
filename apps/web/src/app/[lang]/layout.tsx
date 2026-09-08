import type { Metadata, Viewport } from "next";
import { Baloo_2, Bricolage_Grotesque, IBM_Plex_Sans, IBM_Plex_Sans_Devanagari } from "next/font/google";
import { notFound } from "next/navigation";
import { BottomNav } from "@/components/BottomNav";
import { Footer } from "@/components/Footer";
import { OfflineBanner } from "@/components/OfflineBanner";
import { Header } from "@/components/Header";
import { Providers } from "@/components/Providers";
import { SITE_URL } from "@/lib/api";
import { isSupportedLang, localeHref } from "@/lib/languages";
import { fetchCategories, fetchConfig, fetchFooterPages, fetchLanguages, fetchTranslations } from "@/lib/server-data";
import { colors } from "@/lib/tokens";
import "@katha/tokens/tokens.css";
import "../globals.css";

const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const body = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-body", display: "swap" });
// Devanagari pair for Hindi / Marathi: Baloo 2 carries the display voice, IBM Plex Sans Devanagari the body.
const displayDevanagari = Baloo_2({ subsets: ["latin", "devanagari"], variable: "--font-display", display: "swap" });
const bodyDevanagari = IBM_Plex_Sans_Devanagari({
  subsets: ["latin", "devanagari"],
  weight: ["400", "500", "600"],
  variable: "--font-body",
  display: "swap",
});

const DEVANAGARI_LANGS = new Set(["hi", "mr"]);

function fontClasses(lang: string): string {
  return DEVANAGARI_LANGS.has(lang)
    ? `${displayDevanagari.variable} ${bodyDevanagari.variable}`
    : `${display.variable} ${body.variable}`;
}

export async function generateMetadata({ params }: LayoutProps<"/[lang]">): Promise<Metadata> {
  const { lang } = await params;
  const [languages, messages] = await Promise.all([fetchLanguages(), fetchTranslations(lang)]);
  const t = (key: string, fallback: string) => messages[key] || fallback;
  const siteName = t("meta.site_name", "Katha");
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: t("meta.title", "Katha — short dramas"), template: `%s · ${siteName}` },
    description: t("meta.description", "Binge bite-sized dramas in your language."),
    alternates: {
      canonical: localeHref(lang, "/"),
      languages: Object.fromEntries(languages.map((l) => [l.code, localeHref(l.code, "/")])),
    },
    openGraph: { siteName, type: "website", locale: lang },
    twitter: { card: "summary_large_image" },
    icons: { icon: "/icon-192.png", apple: "/apple-icon.png" },
    appleWebApp: { capable: true, title: siteName, statusBarStyle: "black-translucent" },
  };
}

export const viewport: Viewport = { themeColor: colors.ground, width: "device-width", initialScale: 1 };

export default async function RootLayout({ children, params }: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  if (!isSupportedLang(lang)) notFound();

  const [languages, messages, pages, config, categories] = await Promise.all([
    fetchLanguages(),
    fetchTranslations(lang),
    fetchFooterPages(lang),
    fetchConfig(),
    fetchCategories(lang),
  ]);
  const dir: "ltr" | "rtl" = languages.find((l) => l.code === lang)?.rtl ? "rtl" : "ltr";
  const t = (key: string, fallback: string) => messages[key] || fallback;

  return (
    <html lang={lang} dir={dir} className={`${fontClasses(lang)} h-full`}>
      <body className="flex min-h-full flex-col">
        <Providers value={{ lang, dir, languages, messages, config }}>
          {/* First tab stop on every page. Without it a keyboard or screen-reader user walks the whole header —
              logo, five nav links, search, language, account — before reaching the content, on every navigation. */}
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-accent-ink"
          >
            {t("common.skip_to_content", "Skip to content")}
          </a>
          <Header />
          <OfflineBanner />
          {/* pb-14 clears the fixed bottom tab bar below md; it is `hidden` from md up, where the header nav takes over. */}
          <main id="main" tabIndex={-1} className="flex-1 pb-14 md:pb-0">
            {children}
          </main>
          <Footer
            lang={lang}
            pages={pages}
            categories={categories}
            languages={languages}
            contactLabel={t("nav.contact", "Contact")}
            tagline={t("footer.tagline", "Bite-sized dramas, made for your phone.")}
            labels={{
              browse: t("nav.browse", "Browse"),
              watch: t("footer.watch", "Watch"),
              company: t("footer.company", "Company"),
              languages: t("footer.languages", "Languages"),
              shorts: t("nav.shorts", "Shorts"),
              rewards: t("nav.rewards", "Rewards"),
            }}
          />
          <BottomNav />
        </Providers>
      </body>
    </html>
  );
}
