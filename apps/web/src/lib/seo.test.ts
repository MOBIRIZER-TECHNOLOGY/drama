import { describe, expect, it } from "vitest";
import { absoluteUrl, breadcrumbJsonLd, tvSeriesJsonLd, videoObjectJsonLd, webSiteJsonLd } from "./seo";
import type { EpisodeOut, SeriesDetail } from "./types";

const series = {
  slug: "my-show",
  title: "My Show",
  episode_count: 10,
  cover_url: "https://cdn/x.jpg",
  meta_description: "",
  synopsis: "A synopsis",
  categories: [{ name: "Drama" }, { name: "Romance" }],
  released_at: "2026-01-02T03:04:05Z",
  like_count: 5,
} as unknown as SeriesDetail;

describe("seo", () => {
  it("builds absolute urls with the language prefix", () => {
    expect(absoluteUrl("en", "/x")).toBe("http://localhost:3000/x");
    expect(absoluteUrl("hi", "/x")).toBe("http://localhost:3000/hi/x");
  });

  it("builds breadcrumbs; the last crumb has no item", () => {
    const ld = breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Show" }], "hi") as { itemListElement: Record<string, unknown>[] };
    expect(ld.itemListElement[0]).toMatchObject({ position: 1, name: "Home", item: "http://localhost:3000/hi" });
    expect(ld.itemListElement[1]).toEqual({ "@type": "ListItem", position: 2, name: "Show" });
  });

  it("builds TVSeries with all optional fields", () => {
    expect(tvSeriesJsonLd(series, "en")).toMatchObject({
      "@type": "TVSeries",
      name: "My Show",
      url: "http://localhost:3000/series/my-show",
      numberOfEpisodes: 10,
      image: "https://cdn/x.jpg",
      description: "A synopsis",
      genre: ["Drama", "Romance"],
      datePublished: "2026-01-02",
      interactionStatistic: { userInteractionCount: 5 },
    });
  });

  it("omits optional TVSeries fields when absent and prefers meta_description", () => {
    const bare = { ...series, cover_url: null, synopsis: "", meta_description: "", categories: [], released_at: null, like_count: 0 } as unknown as SeriesDetail;
    const ld = tvSeriesJsonLd(bare, "en");
    for (const k of ["image", "description", "genre", "datePublished", "interactionStatistic"]) expect(ld).not.toHaveProperty(k);
    expect(tvSeriesJsonLd({ ...series, meta_description: "meta" } as SeriesDetail, "en")).toMatchObject({ description: "meta" });
  });

  it("builds VideoObject only with a thumbnail", () => {
    expect(videoObjectJsonLd(series, { number: 1, thumbnail_url: null } as EpisodeOut, "en")).toBeNull();
    const ld = videoObjectJsonLd(series, { number: 2, title: "Pilot", thumbnail_url: "t.jpg", duration_sec: 0.2 } as EpisodeOut, "en")!;
    expect(ld).toMatchObject({
      name: "My Show – Pilot",
      description: "A synopsis",
      thumbnailUrl: ["t.jpg"],
      duration: "PT1S",
      url: "http://localhost:3000/series/my-show/2",
    });
  });

  it("falls back for untitled episodes and missing description/duration", () => {
    const s = { ...series, synopsis: "", meta_description: "" } as SeriesDetail;
    const ld = videoObjectJsonLd(s, { number: 3, title: "", thumbnail_url: "t", duration_sec: null } as unknown as EpisodeOut, "en")!;
    expect(ld.name).toBe("My Show – Episode 3");
    expect(ld.description).toBe("My Show");
    expect(ld).not.toHaveProperty("duration");
  });

  it("builds WebSite with SearchAction", () => {
    const ld = webSiteJsonLd("hi", "Katha") as { potentialAction: { target: { urlTemplate: string } } };
    expect(ld.potentialAction.target.urlTemplate).toBe("http://localhost:3000/hi/search?q={search_term_string}");
  });
});
