import { render as rtlRender, screen } from "@testing-library/react";
import { appWrapper } from "@/test-utils/app";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => import("@/test-utils/next-navigation"));
const render = (ui: React.ReactElement) => rtlRender(ui, { wrapper: appWrapper() });
const fetchHome = vi.fn();
const fetchTranslations = vi.fn();
const fetchCategories = vi.fn();
vi.mock("@/lib/server-data", () => ({
  fetchHome: (...a: unknown[]) => fetchHome(...a),
  fetchTranslations: (...a: unknown[]) => fetchTranslations(...a),
  fetchCategories: (...a: unknown[]) => fetchCategories(...a),
}));
vi.mock("@/components/JsonLd", () => ({ JsonLd: ({ data }: { data: unknown }) => <script data-testid="jsonld">{JSON.stringify(data)}</script> }));
vi.mock("@/components/LandingIntro", () => ({ LandingIntro: ({ filmCatalogue }: { filmCatalogue: boolean }) => <div data-testid="intro">{String(filmCatalogue)}</div> }));
vi.mock("@/components/HeroCarousel", () => ({ HeroCarousel: ({ items }: { items: { id: string }[] }) => <div data-testid="hero">{items.map((i) => i.id).join(",")}</div> }));
vi.mock("@/components/GuestContinue", () => ({ GuestContinue: () => <div>guest-continue</div> }));
vi.mock("@/components/PersonalRails", () => ({ PersonalRails: () => <div>personal-rails</div> }));
vi.mock("@/components/CategoryBar", () => ({ CategoryBar: ({ categories }: { categories: { id: string }[] }) => <div data-testid="cats">{categories.map((c) => c.id).join(",")}</div> }));
vi.mock("@/components/Rail", () => ({ Rail: ({ title, id, children }: { title: string; id?: string; children: ReactNode }) => <section data-id={id}><h2>{title}</h2>{children}</section> }));
vi.mock("@/components/SeriesCard", () => ({ SeriesCard: ({ series, rank }: { series: { id: string }; rank?: number }) => <div data-testid="card">{series.id}{rank ? `#${rank}` : ""}</div> }));

import HomePage from "./page";

type S = { id?: string; is_featured?: boolean; episode_count?: number; free_episodes?: number; is_premium?: boolean; categories?: { id: string; slug: string }[] };
const s = (id: string, o: S = {}) => ({ is_featured: false, episode_count: 5, free_episodes: 1, is_premium: false, categories: [] as { id: string; slug: string }[], ...o, id });
const rail = (key: string, items: ReturnType<typeof s>[], title = key) => ({ key, title, items });
const page = () => HomePage({ params: Promise.resolve({ lang: "hi" }) } as never);

beforeEach(() => {
  fetchHome.mockReset();
  fetchTranslations.mockReset().mockResolvedValue({});
  fetchCategories.mockReset().mockResolvedValue([{ id: "c1" }, { id: "c2" }]);
});

describe("home page", () => {
  it("shows an error state when the catalogue fails", async () => {
    fetchHome.mockResolvedValue({ ok: false, status: 500 });
    render(await page());
    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't load the home page");
  });

  it("shows an empty state when only per-user or empty rails exist", async () => {
    fetchHome.mockResolvedValue({ ok: true, data: { rails: [rail("continue", [s("1")]), rail("for_you", [s("2")]), rail("x", [])] } });
    render(await page());
    expect(screen.getByText("Nothing to watch yet")).toBeInTheDocument();
  });

  it("renders hero from the featured rail, ranked top picks and other rails, excluding per-user rails", async () => {
    fetchHome.mockResolvedValue({
      ok: true,
      data: {
        rails: [
          rail("featured", [s("f1"), s("f2")], "Featured"),
          rail("top_picks", Array.from({ length: 12 }, (_, i) => s(`t${i}`))),
          rail("new", [s("n1")], "New"),
          rail("continue", [s("c1")]),
        ],
      },
    });
    render(await page());
    expect(screen.getByTestId("hero")).toHaveTextContent("f1,f2");
    expect(screen.getByTestId("intro")).toHaveTextContent("false");
    expect(screen.getByTestId("cats")).toHaveTextContent("c1,c2");
    expect(screen.getByText("guest-continue")).toBeInTheDocument();
    expect(screen.getByText("personal-rails")).toBeInTheDocument();
    expect(screen.getByText("Top picks")).toBeInTheDocument();
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.queryByText("Featured")).toBeNull();
    const cards = screen.getAllByTestId("card").map((c) => c.textContent);
    expect(cards.filter((c) => c!.includes("#"))).toHaveLength(10);
    expect(cards).toContain("t0#1");
    expect(cards).toContain("n1");
    expect(cards).not.toContain("c1");
    expect(screen.getByTestId("jsonld").textContent).toContain('"@type":"WebSite"');
  });

  it("builds the hero from featured series when there is no featured rail, capped at six", async () => {
    const items = Array.from({ length: 8 }, (_, i) => s(`a${i}`, { is_featured: true }));
    fetchHome.mockResolvedValue({ ok: true, data: { rails: [rail("new", items, "New")] } });
    render(await page());
    expect(screen.getByTestId("hero").textContent).toBe("a0,a1,a2,a3,a4,a5");
  });

  it("omits hero and genres when there is nothing featured or no categories", async () => {
    fetchCategories.mockResolvedValue([]);
    fetchHome.mockResolvedValue({ ok: true, data: { rails: [rail("new", [s("n1")], "New")] } });
    render(await page());
    expect(screen.queryByTestId("hero")).toBeNull();
    expect(screen.queryByTestId("cats")).toBeNull();
  });

  it("falls back to rendering the featured rail itself when it is the only rail", async () => {
    fetchHome.mockResolvedValue({ ok: true, data: { rails: [rail("featured", [s("f1")], "Featured")] } });
    render(await page());
    expect(screen.getByText("Featured")).toBeInTheDocument();
    expect(screen.getByTestId("card")).toHaveTextContent("f1");
  });

  it("treats an all-free short-films catalogue as a film catalogue: only top picks, only used genres", async () => {
    const film = (id: string) => s(id, { episode_count: 1, free_episodes: 1, categories: [{ id: "c1", slug: "short-films" }] });
    fetchHome.mockResolvedValue({
      ok: true,
      data: { rails: [rail("top_picks", [film("1")]), rail("new", [film("2")], "New")] },
    });
    render(await page());
    expect(screen.getByTestId("intro")).toHaveTextContent("true");
    expect(screen.getByTestId("cats")).toHaveTextContent(/^c1$/);
    expect(screen.queryByText("New")).toBeNull();
    expect(screen.getByText("Top picks")).toBeInTheDocument();
  });

  it("is not a film catalogue if any title is premium or partly paid", async () => {
    const film = (id: string, o: S) => s(id, { episode_count: 1, free_episodes: 1, categories: [{ id: "c1", slug: "short-films" }], ...o });
    fetchHome.mockResolvedValue({
      ok: true,
      data: { rails: [rail("top_picks", [film("1", {}), film("2", { is_premium: true })]), rail("new", [film("3", {})], "New")] },
    });
    render(await page());
    expect(screen.getByTestId("intro")).toHaveTextContent("false");
    expect(screen.getByText("New")).toBeInTheDocument();
  });

  it("uses translated labels", async () => {
    fetchTranslations.mockResolvedValue({ "home.top_picks": "टॉप" });
    fetchHome.mockResolvedValue({ ok: true, data: { rails: [rail("top_picks", [s("1")])] } });
    render(await page());
    expect(screen.getByText("टॉप")).toBeInTheDocument();
  });
});
