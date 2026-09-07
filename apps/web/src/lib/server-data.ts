import { cache } from "react";
import { api, timeoutSignal } from "./api";
import { FALLBACK_LANGS } from "./languages";
import type {
  AppConfig,
  CategoryOut,
  CmsPageOut,
  FooterLink,
  HomeOut,
  LanguageOut,
  SeriesCard,
  SeriesDetail,
  ShortsOut,
  SitemapOut,
} from "./types";

/**
 * Every fetcher here swallows network errors and returns a fallback so that pages render an
 * empty/error state instead of crashing (the build must succeed with the API unreachable).
 * All exports are wrapped in React `cache()` so generateMetadata and the page share one request.
 */

type Memo<T> = { at: number; value: T };
const memo = new Map<string, Memo<unknown>>();

/**
 * Small in-memory memo for layout data. Only successful responses (non-null) are stored, so a transient API
 * outage is retried on the next request instead of pinning the fallback for the whole TTL.
 */
async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T | null>): Promise<T | null> {
  const hit = memo.get(key) as Memo<T> | undefined;
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  try {
    const value = await fn();
    if (value !== null) memo.set(key, { at: Date.now(), value });
    return value;
  } catch {
    return null;
  }
}

const FALLBACK_LANGUAGE_ROWS: LanguageOut[] = FALLBACK_LANGS.map((code) => ({
  code,
  name: code === "hi" ? "Hindi" : "English",
  native_name: code === "hi" ? "हिन्दी" : "English",
  rtl: false,
}));

export const fetchLanguages = cache(async (): Promise<LanguageOut[]> => {
  const rows = await cached("languages", 60_000, async () => {
    const { data } = await api.GET("/v1/languages", { signal: timeoutSignal() });
    return data && data.length ? data : null;
  });
  return rows ?? FALLBACK_LANGUAGE_ROWS;
});

export const fetchTranslations = cache(async (lang: string): Promise<Record<string, string>> => {
  const messages = await cached(`translations:${lang}`, 60_000, async () => {
    const { data } = await api.GET("/v1/translations/{lang}", { params: { path: { lang } }, signal: timeoutSignal() });
    return data?.messages ?? null;
  });
  return messages ?? {};
});

export const fetchFooterPages = cache(async (lang: string): Promise<FooterLink[]> => {
  const pages = await cached(`pages:${lang}`, 60_000, async () => {
    const { data } = await api.GET("/v1/pages", { params: { query: { lang } }, signal: timeoutSignal() });
    return data ?? null;
  });
  return pages ?? [];
});

export const fetchConfig = cache(async (): Promise<AppConfig | null> => {
  return cached("config", 60_000, async () => {
    const { data } = await api.GET("/v1/config", { signal: timeoutSignal() });
    return data ?? null;
  });
});

export type Loaded<T> = { ok: true; data: T } | { ok: false; status: number };

async function load<T>(fn: () => Promise<{ data?: T; response: Response }>): Promise<Loaded<T>> {
  try {
    const { data, response } = await fn();
    if (data === undefined) return { ok: false, status: response.status };
    return { ok: true, data };
  } catch {
    return { ok: false, status: 0 };
  }
}

export const fetchHome = cache(
  (lang: string): Promise<Loaded<HomeOut>> => load(() => api.GET("/v1/home", { params: { query: { lang } }, signal: timeoutSignal() })),
);

/** Every category with its top series, in one request. Replaces 1 + N calls on the browse page. */
export const fetchBrowse = cache(
  (lang: string): Promise<Loaded<HomeOut>> =>
    load(() => api.GET("/v1/browse", { params: { query: { lang } }, signal: timeoutSignal() })),
);

/** The vertical feed's first page. Episode-level and paginated; the client continues from `next_cursor`. */
export const fetchShorts = cache(
  (lang: string): Promise<Loaded<ShortsOut>> =>
    load(() => api.GET("/v1/shorts", { params: { query: { lang } }, signal: timeoutSignal() })),
);

export const fetchSeries = cache(
  (slug: string, lang: string): Promise<Loaded<SeriesDetail>> =>
    load(() =>
      api.GET("/v1/series/{id_or_slug}", { params: { path: { id_or_slug: slug }, query: { lang } }, signal: timeoutSignal() }),
    ),
);

export const searchSeries = cache(
  (q: string, lang: string): Promise<Loaded<SeriesCard[]>> =>
    load(() => api.GET("/v1/series", { params: { query: { q, lang, limit: 40 } }, signal: timeoutSignal() })),
);

export const fetchPage = cache(
  (slug: string, lang: string): Promise<Loaded<CmsPageOut>> =>
    load(() => api.GET("/v1/pages/{slug}", { params: { path: { slug }, query: { lang } }, signal: timeoutSignal() })),
);

export const fetchCategories = cache(async (): Promise<CategoryOut[]> => {
  const rows = await cached("categories", 60_000, async () => {
    const { data } = await api.GET("/v1/categories", { signal: timeoutSignal() });
    return data ?? null;
  });
  return rows ?? [];
});

export type SeriesListQuery = { lang: string; category?: string; limit?: number; offset?: number };

export const fetchSeriesList = cache(
  ({ lang, category, limit = 40, offset = 0 }: SeriesListQuery): Promise<Loaded<SeriesCard[]>> =>
    load(() =>
      api.GET("/v1/series", {
        params: { query: { lang, category: category || undefined, limit, offset } },
        signal: timeoutSignal(),
      }),
    ),
);

export const fetchSitemap = cache(
  (): Promise<Loaded<SitemapOut>> => load(() => api.GET("/v1/sitemap", { signal: timeoutSignal(10_000) })),
);
