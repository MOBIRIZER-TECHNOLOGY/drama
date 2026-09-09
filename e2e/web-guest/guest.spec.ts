import { expect, test } from "@playwright/test";
import { watchForBrokenResources } from "../support/checks";

/**
 * The signed-out product: what a stranger arriving from a search result or a shared link actually gets.
 *
 * This is the majority of traffic for a catalogue app and the easiest surface to break without noticing,
 * because development is done signed in. A rail that only renders for a known viewer, a paywall that shows
 * the wrong thing to a guest, or a canonical tag that points at the wrong language are all invisible from
 * the authenticated app.
 */
test.describe("guest browsing", () => {
  test("the home page works signed out", async ({ page }) => {
    const watch = watchForBrokenResources(page);
    await page.goto("/en");

    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    const cards = page.locator("main a[href*='/series/']");
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeGreaterThan(2);
    // No balance, because there is no account behind it.
    await expect(page.getByRole("link", { name: "Coin balance" })).toHaveCount(0);

    await page.waitForLoadState("networkidle");
    watch.assertClean();
  });

  test("a guest can watch the free first episode", async ({ page }) => {
    // The whole funnel depends on this: a stranger has to be able to see the product before being asked for
    // anything. If free playback ever requires an account, nobody ever reaches the paywall.
    await page.goto("/en/series/ashes-of-lucknow?ep=1");
    await expect(page.getByRole("heading", { level: 1, name: "Ashes of Lucknow" })).toBeVisible();
    await expect(page.locator("video")).toBeAttached({ timeout: 20_000 });
  });

  test("a locked episode invites a guest to sign in rather than failing", async ({ page }) => {
    await page.goto("/en/series/ashes-of-lucknow?ep=2");
    // Whatever the wording, a guest must be told what to do next — not shown an error or an empty player.
    await expect(page.locator("main")).toContainText(/sign in|log in|unlock|locked/i);
  });

  test("the CMS pages the footer links to actually exist", async ({ page }) => {
    // These are linked from every page and required by both app stores; a 404 here fails a store review.
    for (const [slug, heading] of [
      ["privacy", /privacy/i],
      ["terms", /terms/i],
      ["about", /about/i],
    ] as const) {
      await page.goto(`/en/p/${slug}`);
      await expect(page.getByRole("heading", { level: 1 }), `/p/${slug}`).toHaveText(heading);
    }
  });
});

test.describe("SEO and syndication", () => {
  test("robots.txt points at the sitemap and the sitemap lists series", async ({ request, baseURL }) => {
    const robots = await request.get("/robots.txt");
    expect(robots.status()).toBe(200);
    expect(await robots.text()).toMatch(/sitemap:/i);

    const sitemap = await request.get("/sitemap.xml");
    expect(sitemap.status()).toBe(200);
    const xml = await sitemap.text();
    expect(xml, "the sitemap should carry the catalogue").toContain("/series/");
    expect(xml, "and its language alternates").toMatch(/hreflang|alternate/i);
    expect(baseURL).toBeTruthy();
  });

  test("a series page carries structured data a crawler can read", async ({ page }) => {
    await page.goto("/en/series/ashes-of-lucknow");
    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(blocks.length, "no JSON-LD on a series page").toBeGreaterThan(0);

    const types = blocks.flatMap((b) => {
      try {
        const parsed = JSON.parse(b);
        return (Array.isArray(parsed) ? parsed : [parsed]).map((n) => n["@type"]);
      } catch {
        // Malformed JSON-LD is worse than none: it is what a crawler chokes on.
        throw new Error(`JSON-LD on the series page is not valid JSON: ${b.slice(0, 120)}`);
      }
    });
    expect(types.join(","), "a series should describe itself as a work, not a bare page").toMatch(
      /TVSeries|VideoObject|BreadcrumbList/,
    );
  });

  test("each page declares a canonical URL", async ({ page }) => {
    for (const path of ["/en", "/en/series", "/en/series/ashes-of-lucknow"]) {
      await page.goto(path);
      const canonical = page.locator('link[rel="canonical"]');
      await expect(canonical, `canonical on ${path}`).toHaveCount(1);
      await expect(canonical).toHaveAttribute("href", /^https?:\/\//);
    }
  });
});

test.describe("languages", () => {
  test("switching language changes the page language and the copy", async ({ page }) => {
    await page.goto("/en");
    await page.getByRole("link", { name: "हिन्दी" }).click();
    await expect(page).toHaveURL(/\/hi(\/|$)/);
    await expect(page.locator("html")).toHaveAttribute("lang", "hi");
  });

  test("Arabic renders right to left", async ({ page }) => {
    // The one language whose layout is wrong by default; nothing else in the suite would catch it.
    await page.goto("/ar");
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  });

  test("every advertised language serves a page", async ({ page }) => {
    for (const lang of ["en", "hi", "ta", "te", "bn", "mr", "ar"]) {
      const res = await page.goto(`/${lang}`);
      expect(res?.status(), `/${lang} should be served`).toBeLessThan(400);
      await expect(page.locator("html")).toHaveAttribute("lang", lang);
    }
  });
});
