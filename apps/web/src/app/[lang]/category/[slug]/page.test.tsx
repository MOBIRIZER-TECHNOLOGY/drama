import { render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appWrapper } from "@/test-utils/app";

vi.mock("next/navigation", () => import("@/test-utils/next-navigation"));
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: appWrapper() });
const fetchCategories = vi.fn();
const fetchLanguages = vi.fn();
const fetchSeriesList = vi.fn();
const fetchTranslations = vi.fn();
vi.mock("@/lib/server-data", () => ({
  fetchCategories: (...a: unknown[]) => fetchCategories(...a),
  fetchLanguages: () => fetchLanguages(),
  fetchSeriesList: (...a: unknown[]) => fetchSeriesList(...a),
  fetchTranslations: (...a: unknown[]) => fetchTranslations(...a),
}));
vi.mock("@/components/JsonLd", () => ({ JsonLd: ({ data }: { data: unknown }) => <script data-testid="jsonld">{JSON.stringify(data)}</script> }));
vi.mock("@/components/CategoryBar", () => ({ CategoryBar: ({ activeSlug }: { activeSlug: string }) => <i data-testid="catbar">{activeSlug}</i> }));
vi.mock("@/components/SeriesCard", () => ({ SeriesCard: ({ series }: { series: { id: string } }) => <i data-testid="card">{series.id}</i> }));

import CategoryPage, { generateMetadata } from "./page";

const args = (sp: Record<string, string | string[] | undefined> = {}, slug = "romance") =>
  ({ params: Promise.resolve({ lang: "hi", slug }), searchParams: Promise.resolve(sp) }) as never;
const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i}` }));

beforeEach(() => {
  fetchCategories.mockReset().mockResolvedValue([{ id: "1", slug: "romance", name: "Romance" }]);
  fetchLanguages.mockReset().mockResolvedValue([{ code: "en" }, { code: "hi" }]);
  fetchSeriesList.mockReset();
  fetchTranslations.mockReset().mockResolvedValue({});
});

describe("category metadata", () => {
  it("builds title, description and canonical for page 1", async () => {
    const m = await generateMetadata(args());
    expect(m.title).toBe("Romance dramas");
    expect(m.description).toBe("Watch Romance short dramas on Katha.");
    expect(m.alternates).toEqual({ canonical: "/hi/category/romance", languages: { en: "/category/romance", hi: "/hi/category/romance" } });
  });
  it("titles and canonicals deep pages distinctly, clamping offsets", async () => {
    const m = await generateMetadata(args({ offset: ["80"] }));
    expect(m.title).toBe("Romance dramas — page 3");
    expect(m.alternates?.canonical).toBe("/hi/category/romance?offset=80");
    expect((await generateMetadata(args({ offset: "99999999" }))).alternates?.canonical).toBe("/hi/category/romance?offset=10000");
    expect((await generateMetadata(args({ offset: "-5" }))).alternates?.canonical).toBe("/hi/category/romance");
    expect((await generateMetadata(args({ offset: "abc" }))).title).toBe("Romance dramas");
  });
  it("404s for an unknown category", async () => {
    await expect(generateMetadata(args({}, "nope"))).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("category page", () => {
  it("404s for an unknown category", async () => {
    fetchSeriesList.mockResolvedValue({ ok: true, data: [] });
    await expect(CategoryPage(args({}, "nope"))).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("renders the grid and breadcrumb json-ld, requesting the sort and offset", async () => {
    fetchSeriesList.mockResolvedValue({ ok: true, data: items(3) });
    render(await CategoryPage(args({ sort: "newest" })));
    expect(fetchSeriesList).toHaveBeenCalledWith({ lang: "hi", category: "romance", sort: "newest", limit: 40, offset: 0 });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Romance");
    expect(screen.getAllByTestId("card")).toHaveLength(3);
    expect(screen.getByTestId("catbar")).toHaveTextContent("romance");
    expect(screen.getByTestId("jsonld").textContent).toContain("BreadcrumbList");
    expect(screen.getByText("Browse all dramas", { selector: "a" }).getAttribute("href")).toBe("/hi/series");
    expect(screen.queryByText("Next")).toBeNull();
    // sort links reset the offset and keep the sort
    expect(screen.getByText("Most watched").getAttribute("href")).toBe("/hi/category/romance?sort=popular");
    expect(screen.getByText("Featured").getAttribute("href")).toBe("/hi/category/romance");
  });

  it("paginates, carrying the sort in both links", async () => {
    fetchSeriesList.mockResolvedValue({ ok: true, data: items(40) });
    render(await CategoryPage(args({ offset: "40", sort: ["popular"] })));
    expect(screen.getByText("Previous").getAttribute("href")).toBe("/hi/category/romance?sort=popular");
    expect(screen.getByText("Next").getAttribute("href")).toBe("/hi/category/romance?offset=80&sort=popular");
    expect(screen.getByText("Page 2")).toBeInTheDocument();
  });

  it("first full page has Next but no Previous", async () => {
    fetchSeriesList.mockResolvedValue({ ok: true, data: items(40) });
    render(await CategoryPage(args()));
    expect(screen.getByText("Next").getAttribute("href")).toBe("/hi/category/romance?offset=40");
    expect(screen.queryByText("Previous")).toBeNull();
  });

  it("last page has Previous but no Next", async () => {
    fetchSeriesList.mockResolvedValue({ ok: true, data: items(2) });
    render(await CategoryPage(args({ offset: "40" })));
    expect(screen.getByText("Previous")).toBeInTheDocument();
    expect(screen.queryByText("Next")).toBeNull();
  });

  it("empty first page vs empty later page (with a way back) vs failure", async () => {
    fetchSeriesList.mockResolvedValue({ ok: true, data: [] });
    const a = render(await CategoryPage(args()));
    expect(screen.getByText("Nothing here yet")).toBeInTheDocument();
    a.unmount();
    const b = render(await CategoryPage(args({ offset: "80" })));
    expect(screen.getByText("No more dramas on this page")).toBeInTheDocument();
    expect(screen.getByText("Previous").getAttribute("href")).toBe("/hi/category/romance?offset=40");
    b.unmount();
    fetchSeriesList.mockResolvedValue({ ok: false, status: 500 });
    render(await CategoryPage(args()));
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
