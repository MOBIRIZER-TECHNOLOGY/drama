import { render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appWrapper } from "@/test-utils/app";

vi.mock("next/navigation", () => import("@/test-utils/next-navigation"));
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: appWrapper() });
const fetchShorts = vi.fn();
const fetchLanguages = vi.fn();
const fetchTranslations = vi.fn();
vi.mock("@/lib/server-data", () => ({
  fetchShorts: (...a: unknown[]) => fetchShorts(...a),
  fetchLanguages: () => fetchLanguages(),
  fetchTranslations: (...a: unknown[]) => fetchTranslations(...a),
}));
const feedProps = vi.fn();
vi.mock("@/components/shorts/ShortsFeed", () => ({ ShortsFeed: (p: unknown) => (feedProps(p), <i data-testid="feed" />) }));

import ShortsPage, { generateMetadata } from "./page";

const page = (sp: Record<string, string | string[] | undefined> = {}) =>
  ShortsPage({ params: Promise.resolve({ lang: "hi" }), searchParams: Promise.resolve(sp) } as never);

beforeEach(() => {
  feedProps.mockReset();
  fetchShorts.mockReset();
  fetchLanguages.mockReset().mockResolvedValue([{ code: "en" }, { code: "hi" }]);
  fetchTranslations.mockReset().mockResolvedValue({});
});

describe("shorts metadata", () => {
  it("has a parameterless canonical", async () => {
    const m = await generateMetadata({ params: Promise.resolve({ lang: "hi" }) } as never);
    expect(m.alternates).toEqual({ canonical: "/hi/shorts", languages: { en: "/shorts", hi: "/hi/shorts" } });
  });
});

describe("shorts page", () => {
  it("error and empty states", async () => {
    fetchShorts.mockResolvedValue({ ok: false, status: 500 });
    const a = render(await page());
    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't load Shorts");
    a.unmount();
    fetchShorts.mockResolvedValue({ ok: true, data: { items: [], next_cursor: null } });
    render(await page());
    expect(screen.getByText("No shorts yet")).toBeInTheDocument();
  });

  it("passes the feed, cursor and a parsed start position", async () => {
    fetchShorts.mockResolvedValue({ ok: true, data: { items: [{ id: 1 }], next_cursor: "c2" } });
    render(await page({ s: ["slug", "x"], ep: ["7"] }));
    expect(feedProps).toHaveBeenCalledWith({ initial: [{ id: 1 }], nextCursor: "c2", lang: "hi", startAt: { slug: "slug", episode: 7 } });
  });

  it("ignores malformed start params and defaults a missing cursor to null", async () => {
    fetchShorts.mockResolvedValue({ ok: true, data: { items: [{ id: 1 }] } });
    for (const sp of [{ s: "a" }, { ep: "1" }, { s: "a", ep: "x" }, { s: "a", ep: "12345" }]) {
      feedProps.mockReset();
      render(await page(sp));
      expect(feedProps.mock.calls[0][0]).toMatchObject({ nextCursor: null, startAt: null });
    }
  });
});
