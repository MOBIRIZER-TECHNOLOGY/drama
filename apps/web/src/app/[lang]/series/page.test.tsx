import { render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appWrapper } from "@/test-utils/app";

vi.mock("next/navigation", () => import("@/test-utils/next-navigation"));
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: appWrapper() });
const fetchBrowse = vi.fn();
const fetchCategories = vi.fn();
const fetchLanguages = vi.fn();
const fetchSeriesList = vi.fn();
const fetchTranslations = vi.fn();
vi.mock("@/lib/server-data", () => ({
  fetchBrowse: (...a: unknown[]) => fetchBrowse(...a),
  fetchCategories: (...a: unknown[]) => fetchCategories(...a),
  fetchLanguages: () => fetchLanguages(),
  fetchSeriesList: (...a: unknown[]) => fetchSeriesList(...a),
  fetchTranslations: (...a: unknown[]) => fetchTranslations(...a),
}));
vi.mock("@/components/CategoryBar", () => ({ CategoryBar: () => <i data-testid="catbar" /> }));
vi.mock("@/components/Rail", () => ({ Rail: ({ id, title, action, children }: { id: string; title: string; action?: ReactNode; children: ReactNode }) => <section data-id={id}><h2>{title}</h2>{action}{children}</section> }));
vi.mock("@/components/SeriesCard", () => ({ SeriesCard: ({ series }: { series: { id: string } }) => <i data-testid="card">{series.id}</i> }));

import BrowsePage, { generateMetadata } from "./page";

const page = (sp: Record<string, string | string[] | undefined> = {}) =>
  BrowsePage({ params: Promise.resolve({ lang: "hi" }), searchParams: Promise.resolve(sp) } as never);
const items = (n: number, p = "s") => Array.from({ length: n }, (_, i) => ({ id: `${p}${i}` }));

beforeEach(() => {
  for (const f of [fetchBrowse, fetchSeriesList]) f.mockReset();
  fetchCategories.mockReset().mockResolvedValue([]);
  fetchLanguages.mockReset().mockResolvedValue([{ code: "en" }, { code: "hi" }]);
  fetchTranslations.mockReset().mockResolvedValue({});
});

describe("browse metadata", () => {
  it("has canonical and alternates", async () => {
    const m = await generateMetadata({ params: Promise.resolve({ lang: "hi" }) } as never);
    expect(m.title).toBe("Browse all dramas");
    expect(m.alternates).toEqual({ canonical: "/hi/series", languages: { en: "/series", hi: "/hi/series" } });
  });
});

describe("grouped browse", () => {
  it("renders category rails with See all links, skipping empty ones", async () => {
    fetchBrowse.mockResolvedValue({
      ok: true,
      data: { rails: [{ key: "category:romance", title: "Romance", items: items(2) }, { key: "uncategorised", title: "More", items: items(1, "u") }, { key: "category:empty", title: "E", items: [] }] },
    });
    const { container } = render(await page());
    expect(fetchSeriesList).not.toHaveBeenCalled();
    expect(container.querySelector('[data-id="category-romance"]')).not.toBeNull();
    expect(container.querySelector('[data-id="uncategorised"]')).not.toBeNull();
    expect(screen.getByText("See all").getAttribute("href")).toBe("/hi/category/romance");
    expect(screen.queryByText("E")).toBeNull();
    expect(screen.getAllByTestId("card")).toHaveLength(3);
  });

  it("shows empty and error states", async () => {
    fetchBrowse.mockResolvedValue({ ok: true, data: { rails: [] } });
    const a = render(await page());
    expect(screen.getByText("Nothing published yet")).toBeInTheDocument();
    a.unmount();
    fetchBrowse.mockResolvedValue({ ok: false, status: 500 });
    render(await page());
    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't load the catalogue");
  });
});

describe("sorted flat list", () => {
  it("fetches the flat list with offset clamped and shows pagination", async () => {
    fetchSeriesList.mockResolvedValue({ ok: true, data: items(60) });
    render(await page({ sort: ["popular"], offset: "999999" }));
    expect(fetchBrowse).not.toHaveBeenCalled();
    expect(fetchSeriesList).toHaveBeenCalledWith({ lang: "hi", sort: "popular", limit: 60, offset: 10_000 });
    expect(screen.getByText("Previous").getAttribute("href")).toBe("/hi/series?sort=popular&offset=9940");
    expect(screen.getByText("Next").getAttribute("href")).toBe("/hi/series?sort=popular&offset=10060");
    expect(screen.getByText("Page 167")).toBeInTheDocument();
  });

  it("has no pagination on a single short first page", async () => {
    fetchSeriesList.mockResolvedValue({ ok: true, data: items(3) });
    render(await page({ sort: "newest" }));
    expect(screen.queryByText("Next")).toBeNull();
    expect(screen.queryByText("Previous")).toBeNull();
  });

  it("first page full: Next only, previous link of the second page goes back to offset-less url", async () => {
    fetchSeriesList.mockResolvedValue({ ok: true, data: items(60) });
    render(await page({ sort: "updated" }));
    expect(screen.getByText("Next").getAttribute("href")).toBe("/hi/series?sort=updated&offset=60");
  });

  it("last page: Previous only, to first page without offset", async () => {
    fetchSeriesList.mockResolvedValue({ ok: true, data: items(5) });
    render(await page({ sort: "featured", offset: "60" }));
    expect(screen.getByText("Previous").getAttribute("href")).toBe("/hi/series?sort=featured");
    expect(screen.queryByText("Next")).toBeNull();
  });

  it("empty states differ for first vs later pages; errors surface", async () => {
    fetchSeriesList.mockResolvedValue({ ok: true, data: [] });
    const a = render(await page({ sort: "popular" }));
    expect(screen.getByText("Nothing published yet")).toBeInTheDocument();
    a.unmount();
    const b = render(await page({ sort: "popular", offset: "60" }));
    expect(screen.getByText("Nothing more to show")).toBeInTheDocument();
    b.unmount();
    fetchSeriesList.mockResolvedValue({ ok: false, status: 500 });
    render(await page({ sort: "popular" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("ignores an invalid sort and offset", async () => {
    fetchBrowse.mockResolvedValue({ ok: true, data: { rails: [] } });
    await page({ sort: "bogus", offset: "abc" });
    expect(fetchBrowse).toHaveBeenCalled();
    expect(fetchSeriesList).not.toHaveBeenCalled();
  });
});
