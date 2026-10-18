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
vi.mock("@/components/Rail", () => ({ Rail: ({ children }: { children: React.ReactNode }) => <section>{children}</section> }));
vi.mock("@/components/SeriesCard", () => ({ SeriesCard: ({ series }: { series: { id: string } }) => <i data-testid="card">{series.id}</i> }));
const viewProps = vi.fn();
vi.mock("@/components/series/SeriesView", () => ({ SeriesView: (p: unknown) => (viewProps(p), <i data-testid="view" />) }));

import EpisodePage, { generateMetadata } from "./page";

const series = (over = {}) => ({
  id: "1", slug: "show", title: "Show", meta_description: "", synopsis: "", episode_count: 3, like_count: 0, released_at: null,
  categories: [], episodes: [{ number: 2, title: "Twist", thumbnail_url: "t2" }, { number: 3, title: "", thumbnail_url: null }],
  similar: [{ id: "x" }], ...over,
});
const args = (episode = "2") => ({ params: Promise.resolve({ lang: "hi", slug: "show", episode }) }) as never;

beforeEach(() => {
  viewProps.mockReset();
  fetchSeries.mockReset().mockResolvedValue({ ok: true, data: series() });
  fetchLanguages.mockReset().mockResolvedValue([{ code: "en" }, { code: "hi" }]);
  fetchTranslations.mockReset().mockResolvedValue({});
});

describe("episode metadata", () => {
  it("titles by episode, prefers the episode title as description and has its own canonical", async () => {
    const m = await generateMetadata(args());
    expect(m.title).toBe("Show — Episode 2");
    expect(m.description).toBe("Twist");
    expect(m.alternates).toEqual({ canonical: "/hi/series/show/2", languages: { en: "/series/show/2", hi: "/hi/series/show/2" } });
    expect(m.openGraph).toMatchObject({ type: "video.episode" });
  });
  it("falls back through meta description, synopsis and a generic line", async () => {
    expect((await generateMetadata(args("3"))).description).toBe("Watch episode 3 of Show on Katha.");
    fetchSeries.mockResolvedValue({ ok: true, data: series({ synopsis: "Syn" }) });
    expect((await generateMetadata(args("3"))).description).toBe("Syn");
    fetchSeries.mockResolvedValue({ ok: true, data: series({ synopsis: "Syn", meta_description: "Meta" }) });
    expect((await generateMetadata(args("3"))).description).toBe("Meta");
  });
  it("404s on bad episode numbers, missing episodes and missing series; falls back on 5xx", async () => {
    for (const bad of ["0", "abc", "12345", "-1"]) await expect(generateMetadata(args(bad))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(generateMetadata(args("9"))).rejects.toThrow("NEXT_NOT_FOUND");
    fetchSeries.mockResolvedValue({ ok: false, status: 404 });
    await expect(generateMetadata(args())).rejects.toThrow("NEXT_NOT_FOUND");
    fetchSeries.mockResolvedValue({ ok: false, status: 500 });
    expect(await generateMetadata(args())).toEqual({ title: "Episode" });
  });
});

describe("episode page", () => {
  it("404s on bad number/missing episode/missing series and errors softly on 5xx", async () => {
    await expect(EpisodePage(args("x"))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(EpisodePage(args("9"))).rejects.toThrow("NEXT_NOT_FOUND");
    fetchSeries.mockResolvedValue({ ok: false, status: 404 });
    await expect(EpisodePage(args())).rejects.toThrow("NEXT_NOT_FOUND");
    fetchSeries.mockResolvedValue({ ok: false, status: 500 });
    render(await EpisodePage(args()));
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("renders the view on the chosen episode with a three-step trail and video JSON-LD", async () => {
    render(await EpisodePage(args("2")));
    expect(viewProps.mock.calls[0][0]).toMatchObject({ initialEpisode: 2 });
    expect(screen.getByTestId("crumbs")).toHaveTextContent("Browse all dramas>Show>Episode 2");
    const types = (JSON.parse(screen.getByTestId("jsonld").textContent!) as { "@type": string }[]).map((d) => d["@type"]);
    expect(types).toEqual(["TVSeries", "BreadcrumbList", "VideoObject"]);
    expect(screen.getByTestId("card")).toBeInTheDocument();
  });

  it("omits video JSON-LD without a thumbnail and the rail without similar series", async () => {
    fetchSeries.mockResolvedValue({ ok: true, data: series({ similar: [] }) });
    render(await EpisodePage(args("3")));
    const types = (JSON.parse(screen.getByTestId("jsonld").textContent!) as { "@type": string }[]).map((d) => d["@type"]);
    expect(types).toEqual(["TVSeries", "BreadcrumbList"]);
    expect(screen.queryByTestId("card")).toBeNull();
  });
});
