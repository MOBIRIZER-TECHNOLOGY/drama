export const DEFAULT_LANG = "en";
/**
 * Only reached when `NEXT_PUBLIC_LANGS` is absent, which next.config.ts no longer allows for a production
 * build: it is resolved from the API or set explicitly, and the build fails otherwise. This remains for
 * `next dev` and `next typegen` without an API, where next.config.ts warns and uses the same pair.
 */
export const FALLBACK_LANGS = ["en", "hi"];

/**
 * Build-time list (see next.config.ts). The proxy routes by it (a request-time list would put an API call
 * in front of every page); the layout and the sitemap prefer the live list from `fetchLanguages` and use
 * this as the fallback when the API is unreachable.
 */
export const SUPPORTED_LANGS: string[] = (process.env.NEXT_PUBLIC_LANGS ?? FALLBACK_LANGS.join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export function isSupportedLang(lang: string): boolean {
  return SUPPORTED_LANGS.includes(lang);
}

/** `/wallet` for the default language, `/hi/wallet` otherwise. */
export function localeHref(lang: string, path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (lang === DEFAULT_LANG) return p;
  return p === "/" ? `/${lang}` : `/${lang}${p}`;
}

/** Strip a known language prefix from a pathname. */
export function stripLang(pathname: string): string {
  const [, first, ...rest] = pathname.split("/");
  if (first && SUPPORTED_LANGS.includes(first)) return `/${rest.join("/")}`;
  return pathname || "/";
}
