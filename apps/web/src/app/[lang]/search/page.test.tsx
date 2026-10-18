import { render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appWrapper } from "@/test-utils/app";

vi.mock("next/navigation", () => import("@/test-utils/next-navigation"));
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: appWrapper() });
const searchSeries = vi.fn();
const fetchCategories = vi.fn();
const fetchTranslations = vi.fn();
vi.mock("@/lib/server-data", () => ({
  searchSeries: (...a: unknown[]) => searchSeries(...a),
  fetchCategories: (...a: unknown[]) => fetchCategories(...a),
  fetchTranslations: (...a: unknown[]) => fetchTranslations(...a),
}));
vi.mock("@/components/Beacon", () => ({ Beacon: (p: { name: string; remember?: string; props: unknown }) => <i data-testid="beacon">{JSON.stringify(p)}</i> }));
vi.mock("@/components/SearchFacets", () => ({ SearchFacets: (p: { q: string; active: unknown; categories: unknown[] }) => <i data-testid="facets">{JSON.stringify({ q: p.q, active: p.active, n: p.categories.length })}</i> }));
vi.mock("@/components/SearchSuggestions", () => ({ SearchSuggestions: ({ categories }: { categories: unknown[] }) => <i data-testid="suggestions">{categories.length}</i> }));
vi.mock("@/components/SeriesCard", () => ({ SeriesCard: ({ series }: { series: { id: string } }) => <i data-testid="card">{series.id}</i> }));

import SearchPage, { metadata } from "./page";

const cats = Array.from({ length: 15 }, (_, i) => ({ id: `c${i}`, slug: `cat${i}`, name: `Cat ${i}` }));
const page = (sp: Record<string, string | string[] | undefined>) =>
  SearchPage({ params: Promise.resolve({ lang: "en" }), searchParams: Promise.resolve(sp) } as never);

beforeEach(() => {
  searchSeries.mockReset();
  fetchCategories.mockReset().mockResolvedValue(cats);
  fetchTranslations.mockReset().mockResolvedValue({});
});

describe("search page", () => {
  it("is noindex", () => expect(metadata.robots).toEqual({ index: false }));

  it("shows suggestions and no search when there is no query", async () => {
    render(await page({ q: "   " }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Search");
    expect(screen.getByTestId("suggestions")).toHaveTextContent("12");
    expect(searchSeries).not.toHaveBeenCalled();
    expect(screen.queryByTestId("beacon")).toBeNull();
    expect(screen.queryByTestId("facets")).toBeNull();
  });

  it("searches, reports a beacon and renders results", async () => {
    searchSeries.mockResolvedValue({ ok: true, data: [{ id: "a" }, { id: "b" }] });
    render(await page({ q: [" love ", "ignored"], category: "cat3", status: "ongoing", length: "long" }));
    expect(searchSeries).toHaveBeenCalledWith("love", "en", { category: "cat3", status: "ongoing", length: "long" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Results for “love”");
    expect(screen.getAllByTestId("card").map((c) => c.textContent)).toEqual(["a", "b"]);
    expect(JSON.parse(screen.getByTestId("beacon").textContent!)).toMatchObject({ name: "search", remember: "love", props: { q: "love", results: 2, surface: "page" } });
    expect(JSON.parse(screen.getByTestId("facets").textContent!)).toEqual({ q: "love", active: { category: "cat3", status: "ongoing", length: "long" }, n: 12 });
  });

  it("ignores unknown facet values", async () => {
    searchSeries.mockResolvedValue({ ok: true, data: [] });
    render(await page({ q: "x", category: ["nope"], status: "weird", length: ["huge"] }));
    expect(searchSeries).toHaveBeenCalledWith("x", "en", { category: undefined, status: undefined, length: undefined });
    expect(screen.getByText("Check the spelling or try a broader term.")).toBeInTheDocument();
  });

  it("explains filter-caused empty results differently", async () => {
    searchSeries.mockResolvedValue({ ok: true, data: [] });
    render(await page({ q: "x", status: "completed" }));
    expect(screen.getByText("No dramas match that.")).toBeInTheDocument();
    expect(screen.getByText("Nothing matches with these filters. Try clearing one.")).toBeInTheDocument();
  });

  it("shows an error state when search fails, with a null result count in the beacon", async () => {
    searchSeries.mockResolvedValue({ ok: false, status: 500 });
    render(await page({ q: "x" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Search is unavailable right now.");
    expect(JSON.parse(screen.getByTestId("beacon").textContent!).props.results).toBeNull();
  });
});
