import type { Schemas } from "./api";

type Series = Pick<Schemas["AdminSeriesOut"], "translations" | "original_language" | "slug">;

/** Display title: original language, then English, then whatever exists. */
export function seriesTitle(s: Series): string {
  const t =
    s.translations.find((x) => x.lang === s.original_language) ??
    s.translations.find((x) => x.lang === "en") ??
    s.translations[0];
  return t?.title ?? s.slug;
}
