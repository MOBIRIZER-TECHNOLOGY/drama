import { expect, test } from "@playwright/test";

test.describe("SEO routes", () => {
  test("sitemap.xml lists series with language alternates", async ({ request }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.status()).toBe(200);
    const xml = await res.text();

    expect(xml).toContain("<urlset");
    expect(xml).toContain("/series/midnight-heiress");
    expect(xml).toContain("/hi/series/midnight-heiress");
    expect(xml).toContain('hreflang="hi"');
    expect(xml).toContain("/p/terms");
  });

  test("robots.txt points at the sitemap", async ({ request }) => {
    const res = await request.get("/robots.txt");
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain("User-Agent: *");
    expect(body).toContain("/sitemap.xml");
  });

  test("ads.txt and the IndexNow key file are served", async ({ request }) => {
    const ads = await request.get("/ads.txt");
    expect(ads.status()).toBe(200);
    expect(await ads.text()).toContain("pub-0000000000000000");

    const key = await request.get("/katha-e2e-indexnow-key.txt");
    expect(key.status()).toBe(200);
    expect((await key.text()).trim()).toBe("katha-e2e-indexnow-key");
  });

  test("the series page carries TVSeries and VideoObject JSON-LD", async ({ page }) => {
    await page.goto("/series/midnight-heiress");
    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    const types = blocks.flatMap((b) => {
      const parsed = JSON.parse(b);
      return (Array.isArray(parsed) ? parsed : [parsed]).map((x: { "@type": string }) => x["@type"]);
    });
    expect(types).toContain("TVSeries");
  });

  test("the home page carries WebSite JSON-LD with a SearchAction", async ({ page }) => {
    await page.goto("/");
    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    const website = blocks.map((b) => JSON.parse(b)).find((x) => x["@type"] === "WebSite");
    expect(website).toBeTruthy();
    expect(website.potentialAction["@type"]).toBe("SearchAction");
  });
});
