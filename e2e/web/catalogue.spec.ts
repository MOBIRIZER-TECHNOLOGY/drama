import { expect, test } from "@playwright/test";
import { watchForBrokenResources } from "../support/checks";

/**
 * Browsing, against the real catalogue in the database rather than a fixture written to match the code.
 * A serialiser that drops a field, a rail query that returns nothing, or a slug that lists but 404s on its
 * own page all show up here and nowhere else.
 */
test.describe("catalogue", () => {
  test("the home page renders rails from the live catalogue", async ({ page }) => {
    const watch = watchForBrokenResources(page);
    await page.goto("/en");

    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    // Rails are configured server-side, so assert the shape — several populated rails — rather than names an
    // operator is free to change. `count()` does not wait, so it follows an assertion that does.
    const cards = page.locator("main a[href*='/series/']");
    await expect(cards.first()).toBeVisible();
    expect(await page.getByRole("heading", { level: 2 }).count()).toBeGreaterThan(2);
    expect(await cards.count()).toBeGreaterThan(2);

    await page.waitForLoadState("networkidle");
    watch.assertClean();
  });

  test("the signed-in home page loads with the viewer's balance", async ({ page }) => {
    // The regression this exists for: `/v1/home` 500'd for any signed-in viewer with watch history, because
    // a failed recommendation query aborted the transaction the rest of the handler was still using. The
    // page rendered from the server cache and only the client refresh failed, so nothing looked wrong.
    const watch = watchForBrokenResources(page);
    await page.goto("/en");
    const balance = page.getByRole("link", { name: "Coin balance" });
    await expect(balance).toBeVisible();
    await expect(balance).toHaveText(/[\d,]+/);

    await page.waitForLoadState("networkidle");
    watch.assertClean();
  });

  test("every series linked from the home page has a detail page that loads", async ({ page }) => {
    // A card that lists but 404s is the failure this catches: the listing and the detail route resolve a
    // series differently, and only the listing gets exercised by hand.
    await page.goto("/en");
    const slugs = await page.locator("main a[href*='/series/']").evaluateAll((links) => [
      ...new Set(
        links
          .map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? "")
          // Cards link both to the series and straight into its first episode (`?ep=1`); both resolve to the
          // same page, so compare the series root only.
          .map((h) => h.split("?")[0])
          .filter((h) => h.includes("/series/")),
      ),
    ]);
    expect(slugs.length, "the home page should link to some series").toBeGreaterThan(0);

    for (const href of slugs.slice(0, 8)) {
      // Links are written without the language prefix and resolved by the proxy against the current locale;
      // a test navigating to the bare path is not the journey a reader takes.
      await page.goto(`/en${href}`);
      // Waited for in two steps on purpose: `not.toHaveText` on a heading that has not rendered yet fails
      // with "element not found", which reads as a 404 rather than as a page still compiling. The dev
      // server builds each route on first request, so the first visit to one can be slow.
      const heading = page.getByRole("heading", { level: 1 });
      await expect(heading, `${href} should render a page`).toBeVisible({ timeout: 30_000 });
      await expect(heading, `${href} should be a series, not a 404`).not.toHaveText(/this page is missing/i);
    }
  });

  test("browse filters by category and sorts", async ({ page }) => {
    await page.goto("/en/series");
    await expect(page.getByRole("heading", { name: "Browse all dramas" })).toBeVisible();

    const chip = page.locator("a[href^='/category/']").first();
    const name = ((await chip.textContent()) ?? "").trim();
    await chip.click();
    await expect(page).toHaveURL(/\/category\//);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(name);

    await page.goto("/en/series");
    await page.locator("a[href*='sort=newest']").first().click();
    await expect(page).toHaveURL(/sort=newest/);
    await expect(page.locator("main a[href*='/series/']").first()).toBeVisible();
  });

  test("search finds a seeded series, and says so when nothing matches", async ({ page }) => {
    await page.goto("/en/search?q=Ashes");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Ashes");
    await expect(page.getByText("Ashes of Lucknow").first()).toBeVisible();

    await page.goto("/en/search?q=zzzzzznotathing");
    await expect(page.locator("main")).toContainText(/no|nothing|couldn|try/i);
  });

  test("a series page shows its episodes with their lock states", async ({ page }) => {
    const watch = watchForBrokenResources(page);
    await page.goto("/en/series/ashes-of-lucknow");

    await expect(page.getByRole("heading", { level: 1, name: "Ashes of Lucknow" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Episodes" })).toBeVisible();

    // Episodes are buttons that swap the player rather than links, and the lock state lives in the
    // accessible name — which is the only place a screen reader can find it, so it is worth pinning.
    const episodes = page.getByRole("button", { name: /^Episode \d+/ });
    expect(await episodes.count(), "the seeded series has more than one episode").toBeGreaterThan(1);
    await expect(episodes.first()).toHaveAccessibleName(/free|unlocked/i);
    await expect(episodes.nth(1)).toHaveAccessibleName(/unlock for \d+ coins|free|unlocked/i);

    await page.waitForLoadState("networkidle");
    watch.assertClean();
  });

  test("the shorts feed loads and plays without CSP or media failures", async ({ page }) => {
    const watch = watchForBrokenResources(page);
    await page.goto("/en/shorts");

    await expect(page.getByRole("link", { name: "Watch full" }).first()).toBeVisible();
    // The error state a blocked segment produces, and exactly what the broken CSP surfaced as.
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);

    await page.waitForTimeout(3000);
    watch.assertClean();
  });
});
