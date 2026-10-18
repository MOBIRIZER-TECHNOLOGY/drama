import { beforeEach, describe, expect, it, vi } from "vitest";

const GET = vi.fn();
vi.mock("./api", () => ({ api: { GET: (...a: unknown[]) => GET(...a) }, timeoutSignal: (ms?: number) => ({ timeout: ms ?? 6000 }) }));
// React's cache() is request-scoped on the server; in tests make it a pass-through so each call hits the fetcher.
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

type Mod = typeof import("./server-data");
let m: Mod;
const resp = (status = 200) => ({ status }) as Response;

beforeEach(async () => {
  vi.resetModules();
  GET.mockReset();
  m = await import("./server-data");
});

describe("memoised layout data", () => {
  it("fetchLanguages caches successes for 60s then refetches", async () => {
    vi.useFakeTimers();
    GET.mockResolvedValue({ data: [{ code: "ta" }] });
    expect(await m.fetchLanguages()).toEqual([{ code: "ta" }]);
    await m.fetchLanguages();
    expect(GET).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_001);
    await m.fetchLanguages();
    expect(GET).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("fetchLanguages falls back to the build-time list when empty, missing or throwing, and never caches that", async () => {
    GET.mockResolvedValueOnce({ data: [] });
    const fallback = await m.fetchLanguages();
    expect(fallback.map((l) => l.code)).toEqual(["en", "hi"]);
    expect(fallback[0]).toMatchObject({ name: "English", native_name: "English", rtl: false });
    expect(fallback[1].native_name).toBe("हिन्दी");
    GET.mockResolvedValueOnce({ data: undefined });
    await m.fetchLanguages();
    GET.mockRejectedValueOnce(new Error("down"));
    expect((await m.fetchLanguages()).length).toBe(2);
    expect(GET).toHaveBeenCalledTimes(3);
  });

  it("fetchTranslations", async () => {
    GET.mockResolvedValueOnce({ data: { messages: { a: "b" } } });
    expect(await m.fetchTranslations("hi")).toEqual({ a: "b" });
    expect(GET).toHaveBeenCalledWith("/v1/translations/{lang}", { params: { path: { lang: "hi" } }, signal: { timeout: 6000 } });
    GET.mockResolvedValueOnce({ data: undefined });
    expect(await m.fetchTranslations("fr")).toEqual({});
  });

  it("fetchFooterPages", async () => {
    GET.mockResolvedValueOnce({ data: [{ slug: "terms" }] });
    expect(await m.fetchFooterPages("en")).toEqual([{ slug: "terms" }]);
    GET.mockResolvedValueOnce({});
    expect(await m.fetchFooterPages("hi")).toEqual([]);
  });

  it("fetchConfig", async () => {
    GET.mockResolvedValueOnce({ data: { x: 1 } });
    expect(await m.fetchConfig()).toEqual({ x: 1 });
    vi.resetModules();
    m = await import("./server-data");
    GET.mockResolvedValueOnce({});
    expect(await m.fetchConfig()).toBeNull();
  });

  it("fetchCategories keys by language and defaults to en", async () => {
    GET.mockResolvedValue({ data: [{ slug: "x" }] });
    await m.fetchCategories();
    await m.fetchCategories("en");
    await m.fetchCategories("hi");
    expect(GET).toHaveBeenCalledTimes(2);
    GET.mockResolvedValueOnce({});
    expect(await m.fetchCategories("ta")).toEqual([]);
  });
});

describe("Loaded fetchers", () => {
  it("return ok with data", async () => {
    GET.mockResolvedValue({ data: { id: 1 }, response: resp() });
    expect(await m.fetchHome("en")).toEqual({ ok: true, data: { id: 1 } });
    expect(GET).toHaveBeenLastCalledWith("/v1/home", { params: { query: { lang: "en" } }, signal: { timeout: 6000 } });
    await m.fetchBrowse("en");
    expect(GET).toHaveBeenLastCalledWith("/v1/browse", expect.anything());
    await m.fetchShorts("en");
    expect(GET).toHaveBeenLastCalledWith("/v1/shorts", expect.anything());
    await m.fetchSeries("slug", "hi");
    expect(GET).toHaveBeenLastCalledWith("/v1/series/{id_or_slug}", { params: { path: { id_or_slug: "slug" }, query: { lang: "hi" } }, signal: { timeout: 6000 } });
    await m.fetchPage("terms", "en");
    expect(GET).toHaveBeenLastCalledWith("/v1/pages/{slug}", expect.objectContaining({ params: { path: { slug: "terms" }, query: { lang: "en" } } }));
  });

  it("return the HTTP status when there is no data, 0 when it throws", async () => {
    GET.mockResolvedValueOnce({ response: resp(404) });
    expect(await m.fetchHome("en")).toEqual({ ok: false, status: 404 });
    GET.mockRejectedValueOnce(new Error("x"));
    expect(await m.fetchHome("en")).toEqual({ ok: false, status: 0 });
  });

  it("searchSeries passes filters and a 40 limit", async () => {
    GET.mockResolvedValue({ data: [], response: resp() });
    await m.searchSeries("love", "en", { category: "c", status: "ongoing" });
    expect(GET).toHaveBeenLastCalledWith("/v1/series", { params: { query: { q: "love", lang: "en", limit: 40, category: "c", status: "ongoing" } }, signal: { timeout: 6000 } });
    await m.searchSeries("love", "en");
    expect(GET.mock.lastCall![1].params.query).toEqual({ q: "love", lang: "en", limit: 40 });
  });

  it("fetchSeriesList applies defaults and drops an empty category", async () => {
    GET.mockResolvedValue({ data: [], response: resp() });
    await m.fetchSeriesList({ lang: "en", category: "" });
    expect(GET.mock.lastCall![1].params.query).toEqual({ lang: "en", category: undefined, sort: "featured", limit: 40, offset: 0 });
    await m.fetchSeriesList({ lang: "hi", category: "c", sort: "newest", limit: 10, offset: 20 });
    expect(GET.mock.lastCall![1].params.query).toEqual({ lang: "hi", category: "c", sort: "newest", limit: 10, offset: 20 });
  });

  it("fetchSitemap uses a 10s timeout", async () => {
    GET.mockResolvedValue({ data: { entries: [] }, response: resp() });
    expect(await m.fetchSitemap()).toEqual({ ok: true, data: { entries: [] } });
    expect(GET).toHaveBeenCalledWith("/v1/sitemap", { signal: { timeout: 10_000 } });
  });
});

describe("language names", () => {
  it("marks rtl languages and falls back to the code when Intl cannot name it", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_LANGS", "ar,en");
    const spy = vi.spyOn(Intl, "DisplayNames").mockImplementation(() => {
      throw new RangeError("x");
    });
    const mod = await import("./server-data");
    GET.mockResolvedValueOnce({ data: [] });
    const rows = await mod.fetchLanguages();
    expect(rows[0]).toEqual({ code: "ar", name: "ar", native_name: "ar", rtl: true });
    expect(rows[1].rtl).toBe(false);
    spy.mockRestore();
    vi.unstubAllEnvs();
  });

  it("uses the code when DisplayNames has no name", async () => {
    vi.resetModules();
    vi.spyOn(Intl, "DisplayNames").mockImplementation(() => ({ of: () => undefined }) as never);
    const mod = await import("./server-data");
    GET.mockResolvedValueOnce({ data: [] });
    expect((await mod.fetchLanguages())[0].name).toBe("en");
  });
});
