export const DEFAULT_LANG = "en";
export const FALLBACK_LANGS = ["en", "hi"];

/** Build-time list (see next.config.ts). Used by the proxy and for validating the [lang] segment. */
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
