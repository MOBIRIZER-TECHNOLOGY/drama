import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchLanguages = vi.fn();
const fetchSitemap = vi.fn();
vi.mock("@/lib/server-data", () => ({ fetchLanguages: () => fetchLanguages(), fetchSitemap: () => fetchSitemap() }));

import sitemap from "./sitemap";

beforeEach(() => {
  fetchLanguages.mockReset().mockResolvedValue([{ code: "en" }, { code: "hi" }]);
  fetchSitemap.mockReset();
});

describe("sitemap", () => {
  it("lists only static paths when the feed fails", async () => {
    fetchSitemap.mockResolvedValue({ ok: false, status: 500 });
    const s = await sitemap();
    expect(s.map((e) => e.url)).toEqual(["http://localhost:3000/", "http://localhost:3000/series", "http://localhost:3000/shorts"]);
    expect(s[0].priority).toBe(1);
    expect(s[1].priority).toBe(0.7);
    expect(s[0].alternates?.languages).toEqual({
      en: "http://localhost:3000/",
      hi: "http://localhost:3000/hi",
      "x-default": "http://localhost:3000/",
    });
  });

  it("adds series, capped episodes and CMS pages", async () => {
    fetchSitemap.mockResolvedValue({
      ok: true,
      data: {
        series: [
          { slug: "a", updated_at: "2026-01-01T00:00:00Z", episode_count: 2 },
          { slug: "b", updated_at: "2026-01-02T00:00:00Z", episode_count: 500 },
          { slug: "c", updated_at: "2026-01-03T00:00:00Z", episode_count: null },
        ],
        pages: ["terms"],
      },
    });
    const s = await sitemap();
    const urls = s.map((e) => e.url);
    expect(urls).toContain("http://localhost:3000/series/a");
    expect(urls).toContain("http://localhost:3000/series/a/2");
    expect(urls).not.toContain("http://localhost:3000/series/a/3");
    expect(urls).toContain("http://localhost:3000/series/b/120");
    expect(urls).not.toContain("http://localhost:3000/series/b/121");
    expect(urls.filter((u) => u.startsWith("http://localhost:3000/series/c/"))).toEqual([]);
    const ep = s.find((e) => e.url.endsWith("/series/a/1"))!;
    expect(ep.changeFrequency).toBe("monthly");
    expect(ep.alternates?.languages?.hi).toBe("http://localhost:3000/hi/series/a/1");
    expect((s.find((e) => e.url.endsWith("/series/a")) as { lastModified: Date }).lastModified.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(urls.at(-1)).toBe("http://localhost:3000/p/terms");
    expect(s.length).toBe(3 + 3 + 2 + 120 + 1);
  });
});
