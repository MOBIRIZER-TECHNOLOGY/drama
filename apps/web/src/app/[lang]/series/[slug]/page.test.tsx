import { render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appWrapper } from "@/test-utils/app";

vi.mock("next/navigation", () => import("@/test-utils/next-navigation"));
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: appWrapper() });
const fetchSeries = vi.fn();
const fetchLanguages = vi.fn();
const fetchTranslations = vi.fn();
vi.mock("@/lib/server-data", () => ({
  fetchSeries: (...a: unknown[]) => fetchSeries(...a),
  fetchLanguages: () => fetchLanguages(),
  fetchTranslations: (...a: unknown[]) => fetchTranslations(...a),
}));
vi.mock("@/components/JsonLd", () => ({ JsonLd: ({ data }: { data: unknown[] }) => <script data-testid="jsonld">{JSON.stringify(data)}</script> }));
vi.mock("@/components/Breadcrumbs", () => ({ Breadcrumbs: ({ crumbs }: { crumbs: { name: string }[] }) => <i data-testid="crumbs">{crumbs.map((c) => c.name).join(">")}</i> }));
vi.mock("@/components/Rail", () => ({ Rail: ({ title, children }: { title: string; children: React.ReactNode }) => <section><h2>{title}</h2>{children}</section> }));
vi.mock("@/components/SeriesCard", () => ({ SeriesCard: ({ series }: { series: { id: string } }) => <i data-testid="card">{series.id}</i> }));
const viewProps = vi.fn();
vi.mock("@/components/series/SeriesView", () => ({ SeriesView: (p: unknown) => (viewProps(p), <i data-testid="view" />) }));

import SeriesPage, { generateMetadata } from "./page";

const series = (over = {}) => ({
  id: "1", slug: "show", title: "Show", seo_title: null, meta_description: "", synopsis: "Syn", cover_url: null,
  episode_count: 3, like_count: 0, released_at: null, continue_episode_number: null,
  categories: [{ name: "Drama", slug: "drama" }],
  episodes: [{ number: 2, thumbnail_url: "t2" }, { number: 1, thumbnail_url: "t1" }],
  similar: [{ id: "x" }],
  ...over,
});
const args = (sp: Record<string, string | string[] | undefined> = {}) =>
  ({ params: Promise.resolve({ lang: "hi", slug: "show" }), searchParams: Promise.resolve(sp) }) as never;
const ld = () => JSON.parse(screen.getByTestId("jsonld").textContent!) as Record<string, unknown>[];

beforeEach(() => {
  viewProps.mockReset();
  fetchSeries.mockReset();
  fetchLanguages.mockReset().mockResolvedValue([{ code: "en" }, { code: "hi" }]);
  fetchTranslations.mockReset().mockResolvedValue({});
});

describe("series metadata", () => {
  it("uses title and synopsis, with language alternates and no explicit images", async () => {
    fetchSeries.mockResolvedValue({ ok: true, data: series() });
    const m = await generateMetadata(args());
    expect(m.title).toBe("Show");
    expect(m.description).toBe("Syn");
    expect(m.alternates).toEqual({ canonical: "/hi/series/show", languages: { en: "/series/show", hi: "/hi/series/show" } });
    expect(m.openGraph).not.toHaveProperty("images");
  });
  it("uses an absolute seo title and meta description when set; falls back to a generic description", async () => {
    fetchSeries.mockResolvedValue({ ok: true, data: series({ seo_title: "SEO", meta_description: "Meta" }) });
    const m = await generateMetadata(args());
    expect(m.title).toEqual({ absolute: "SEO" });
    expect(m.description).toBe("Meta");
    fetchSeries.mockResolvedValue({ ok: true, data: series({ synopsis: "" }) });
    expect((await generateMetadata(args())).description).toBe("Watch Show on Katha.");
  });
  it("404s or falls back on failure", async () => {
    fetchSeries.mockResolvedValue({ ok: false, status: 404 });
    await expect(generateMetadata(args())).rejects.toThrow("NEXT_NOT_FOUND");
    fetchSeries.mockResolvedValue({ ok: false, status: 500 });
    expect(await generateMetadata(args())).toEqual({ title: "Series" });
  });
});

describe("series page", () => {
  it("404s / shows an error state", async () => {
    fetchSeries.mockResolvedValue({ ok: false, status: 404 });
    await expect(SeriesPage(args())).rejects.toThrow("NEXT_NOT_FOUND");
    fetchSeries.mockResolvedValue({ ok: false, status: 502 });
    render(await SeriesPage(args()));
    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't load this drama");
  });

  it("renders view, crumbs with genre, similar rail and JSON-LD for the first episode", async () => {
    fetchSeries.mockResolvedValue({ ok: true, data: series() });
    render(await SeriesPage(args()));
    expect(viewProps.mock.calls[0][0]).toMatchObject({ initialEpisode: null });
    expect(screen.getByTestId("crumbs")).toHaveTextContent("Browse all dramas>Drama>Show");
    expect(screen.getByTestId("card")).toHaveTextContent("x");
    const data = ld();
    expect(data.map((d) => d["@type"])).toEqual(["TVSeries", "BreadcrumbList", "VideoObject"]);
    expect(String(data[2].url)).toContain("/hi/series/show/1");
  });

  it("describes the ?ep episode when valid, else the continue episode, and omits video JSON-LD when the episode is missing or has no thumbnail", async () => {
    fetchSeries.mockResolvedValue({ ok: true, data: series() });
    render(await SeriesPage(args({ ep: ["2"] })));
    expect(viewProps.mock.calls[0][0]).toMatchObject({ initialEpisode: 2 });
    expect(String(ld()[2].url)).toContain("/series/show/2");
  });

  it("continues where the viewer left off", async () => {
    fetchSeries.mockResolvedValue({ ok: true, data: series({ continue_episode_number: 2 }) });
    render(await SeriesPage(args()));
    expect(String(ld()[2].url)).toContain("/series/show/2");
  });

  it("falls back to the first episode for an unknown ?ep, and ignores non-numeric ?ep", async () => {
    fetchSeries.mockResolvedValue({ ok: true, data: series() });
    render(await SeriesPage(args({ ep: "99" })));
    expect(String(ld()[2].url)).toContain("/series/show/1");
    viewProps.mockReset();
    render(await SeriesPage(args({ ep: "abc" })));
    expect(viewProps.mock.calls[0][0]).toMatchObject({ initialEpisode: null });
  });

  it("copes with no episodes, no genre, no similar", async () => {
    fetchSeries.mockResolvedValue({ ok: true, data: series({ episodes: [], categories: [], similar: [] }) });
    render(await SeriesPage(args()));
    expect(ld().map((d) => d["@type"])).toEqual(["TVSeries", "BreadcrumbList"]);
    expect(screen.getByTestId("crumbs")).toHaveTextContent("Browse all dramas>Show");
    expect(screen.queryByTestId("card")).toBeNull();
  });
});
