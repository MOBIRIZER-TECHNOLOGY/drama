import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => import("@/test-utils/next-navigation"));
vi.mock("next/font/google", () => {
  const f = (name: string) => () => ({ variable: `var-${name}` });
  return { Baloo_2: f("baloo"), Bricolage_Grotesque: f("bricolage"), IBM_Plex_Sans: f("plex"), IBM_Plex_Sans_Devanagari: f("plexdev") };
});
vi.mock("@katha/tokens/tokens.css", () => ({}));
vi.mock("../globals.css", () => ({}));
const fetchers = {
  fetchLanguages: vi.fn(),
  fetchTranslations: vi.fn(),
  fetchFooterPages: vi.fn(),
  fetchConfig: vi.fn(),
  fetchCategories: vi.fn(),
};
vi.mock("@/lib/server-data", () => ({
  fetchLanguages: () => fetchers.fetchLanguages(),
  fetchTranslations: (...a: unknown[]) => fetchers.fetchTranslations(...a),
  fetchFooterPages: (...a: unknown[]) => fetchers.fetchFooterPages(...a),
  fetchConfig: () => fetchers.fetchConfig(),
  fetchCategories: (...a: unknown[]) => fetchers.fetchCategories(...a),
}));
const providerValue = vi.fn();
vi.mock("@/components/Providers", () => ({ Providers: ({ value, children }: { value: unknown; children: React.ReactNode }) => (providerValue(value), <>{children}</>) }));
vi.mock("@/components/Header", () => ({ Header: () => <header>header</header> }));
vi.mock("@/components/OfflineBanner", () => ({ OfflineBanner: () => <div>offline</div> }));
vi.mock("@/components/BottomNav", () => ({ BottomNav: () => <nav>bottom</nav> }));
vi.mock("@/components/Footer", () => ({ Footer: (p: { lang: string; contactLabel: string; labels: { watch: string } }) => <footer>footer:{p.lang}:{p.contactLabel}:{p.labels.watch}</footer> }));

import RootLayout, { dynamic, generateMetadata, viewport } from "./layout";

const params = (lang: string) => Promise.resolve({ lang });
const langs = [
  { code: "en", name: "English", native_name: "English", rtl: false },
  { code: "hi", name: "Hindi", native_name: "हिन्दी", rtl: false },
  { code: "ur", name: "Urdu", native_name: "اردو", rtl: true },
];

beforeEach(() => {
  providerValue.mockReset();
  fetchers.fetchLanguages.mockReset().mockResolvedValue(langs);
  fetchers.fetchTranslations.mockReset().mockResolvedValue({});
  fetchers.fetchFooterPages.mockReset().mockResolvedValue([]);
  fetchers.fetchConfig.mockReset().mockResolvedValue({ cfg: 1 });
  fetchers.fetchCategories.mockReset().mockResolvedValue([]);
});

describe("layout metadata", () => {
  it("is force-dynamic and sets the theme colour", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(viewport).toMatchObject({ width: "device-width", initialScale: 1 });
    expect(viewport.themeColor).toBeTruthy();
  });

  it("builds site metadata with language alternates and translated copy", async () => {
    fetchers.fetchTranslations.mockResolvedValue({ "meta.site_name": "कथा" });
    const m = await generateMetadata({ params: params("hi") } as never);
    expect(String(m.metadataBase)).toBe("http://localhost:3000/");
    expect(m.title).toEqual({ default: "Katha — short dramas", template: "%s · कथा" });
    expect(m.alternates).toEqual({ canonical: "/hi", languages: { en: "/", hi: "/hi", ur: "/ur" } });
    expect(m.openGraph).toMatchObject({ siteName: "कथा", locale: "hi" });
    expect(m.appleWebApp).toMatchObject({ title: "कथा" });
  });
});

describe("root layout", () => {
  const html = async (lang: string) => renderToStaticMarkup(await RootLayout({ children: <p>child</p>, params: params(lang) } as never));

  it("renders the shell with skip link, main, footer and nav, and hands providers the app context", async () => {
    const out = await html("en");
    expect(out).toContain('<html lang="en" dir="ltr" class="var-bricolage var-plex h-full">');
    expect(out).toContain('href="#main"');
    expect(out).toContain("Skip to content");
    expect(out).toMatch(/<main id="main"[^>]*><p>child<\/p><\/main>/);
    expect(out).toContain("header");
    expect(out).toContain("offline");
    expect(out).toContain("footer:en:Contact:Watch");
    expect(out).toContain("bottom");
    expect(providerValue.mock.calls[0][0]).toMatchObject({ lang: "en", dir: "ltr", config: { cfg: 1 }, languages: langs });
  });

  it("uses the Devanagari fonts for Hindi", async () => {
    expect(await html("hi")).toContain("var-baloo var-plexdev");
  });

  it("flips to rtl for rtl languages", async () => {
    vi.stubEnv("NEXT_PUBLIC_LANGS", "en,hi,ur");
    vi.resetModules();
    const mod = await import("./layout");
    const out = renderToStaticMarkup(await mod.default({ children: null, params: params("ur") } as never));
    expect(out).toContain('dir="rtl"');
    vi.unstubAllEnvs();
  });

  it("404s on an unsupported build-time language without calling the API", async () => {
    await expect(html("zz")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(fetchers.fetchLanguages).not.toHaveBeenCalled();
  });

  it("404s on a language the live list has switched off", async () => {
    fetchers.fetchLanguages.mockResolvedValue([langs[0]]);
    await expect(html("hi")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
