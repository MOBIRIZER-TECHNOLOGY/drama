import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rootLang = vi.fn();
vi.mock("next/root-params", () => ({ lang: () => rootLang() }));
const fetchTranslations = vi.fn();
const fetchHome = vi.fn();
vi.mock("@/lib/server-data", () => ({
  fetchTranslations: (...a: unknown[]) => fetchTranslations(...a),
  fetchHome: (...a: unknown[]) => fetchHome(...a),
}));
vi.mock("@/components/SearchBox", () => ({ SearchBox: () => <div>search-box</div> }));
vi.mock("@/components/SeriesCard", () => ({ SeriesCard: ({ series, lang }: { series: { title: string }; lang: string }) => <div>card:{series.title}:{lang}</div> }));

import NotFound from "./not-found";

const s = (id: string) => ({ id, title: `T${id}` });
beforeEach(() => {
  rootLang.mockReset().mockResolvedValue("hi");
  fetchTranslations.mockReset().mockResolvedValue({});
  fetchHome.mockReset();
});

describe("not-found page", () => {
  it("offers search, links in the viewer's language and top picks", async () => {
    fetchHome.mockResolvedValue({
      ok: true,
      data: { rails: [{ key: "other", items: [s("x")] }, { key: "top_picks", items: Array.from({ length: 9 }, (_, i) => s(String(i))) }] },
    });
    render(await NotFound());
    expect(screen.getByText("404")).toBeInTheDocument();
    expect(screen.getByText("search-box")).toBeInTheDocument();
    expect(screen.getByText("Browse all dramas").getAttribute("href")).toBe("/hi/series");
    expect(screen.getByText("Back to home").getAttribute("href")).toBe("/hi");
    expect(screen.getAllByText(/^card:/)).toHaveLength(6);
    expect(screen.getByText("card:T0:hi")).toBeInTheDocument();
    expect(fetchHome).toHaveBeenCalledWith("hi");
  });

  it("falls back to the first non-empty rail", async () => {
    fetchHome.mockResolvedValue({ ok: true, data: { rails: [{ key: "a", items: [] }, { key: "b", items: [s("1")] }] } });
    render(await NotFound());
    expect(screen.getByText("card:T1:hi")).toBeInTheDocument();
  });

  it("omits the section when there is nothing to show or the API failed", async () => {
    fetchHome.mockResolvedValue({ ok: true, data: { rails: [] } });
    const first = render(await NotFound());
    expect(first.container.querySelector("section")).toBeNull();
    first.unmount();
    fetchHome.mockResolvedValue({ ok: false, status: 500 });
    const second = render(await NotFound());
    expect(second.container.querySelector("section")).toBeNull();
  });

  it("uses the default language when the route has none or an unsupported one", async () => {
    fetchHome.mockResolvedValue({ ok: false, status: 0 });
    rootLang.mockResolvedValue(undefined);
    render(await NotFound());
    expect(fetchTranslations).toHaveBeenLastCalledWith("en");
    rootLang.mockResolvedValue("zz");
    await NotFound();
    expect(fetchTranslations).toHaveBeenLastCalledWith("en");
  });

  it("uses translated copy", async () => {
    fetchTranslations.mockResolvedValue({ "not_found.title": "गायब" });
    fetchHome.mockResolvedValue({ ok: false, status: 0 });
    render(await NotFound());
    expect(screen.getByText("गायब")).toBeInTheDocument();
  });
});
