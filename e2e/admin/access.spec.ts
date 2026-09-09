import { expect, test } from "@playwright/test";
import { watchForBrokenResources } from "../support/checks";
import { ADMIN_URL } from "../support/fixture";

/**
 * Every admin route, and the boundary around them.
 *
 * The console is twenty screens wide and one person clicks through maybe five of them in a week. A page that
 * 500s on real data, or one whose API call was renamed, can sit broken for a long time without anyone
 * noticing — so the cheapest useful thing this suite does is open all of them against the live API and
 * assert they arrived, with nothing failing underneath.
 */
const ROUTES: [path: string, heading: RegExp][] = [
  ["/dashboard", /^Dashboard$/],
  ["/dramas", /^Dramas$/],
  ["/categories", /^Categories$/],
  ["/languages", /^Languages & translations$/],
  ["/pages", /^Pages$/],
  ["/users", /^Users$/],
  ["/purchases", /^Purchases$/],
  ["/packs", /^Coin packs$/],
  ["/rewards", /^Reward tasks$/],
  ["/experiments", /^Experiments$/],
  ["/flags", /^Feature flags$/],
  ["/offers", /^Offers & coupons$/],
  ["/ads", /^Ad placements$/],
  ["/notifications", /^Notifications$/],
  ["/moderation", /^Moderation$/],
  ["/reports", /^Reports$/],
  ["/inbox", /^Inbox$/],
  ["/settings", /^Settings$/],
  ["/accounts", /^Admin accounts$/],
  ["/audit", /^Audit log$/],
];

test.describe("admin routes", () => {
  for (const [path, heading] of ROUTES) {
    test(`${path} loads without errors`, async ({ page }) => {
      const watch = watchForBrokenResources(page);
      await page.goto(path);

      await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
      // An error banner is how a failed fetch surfaces here, and it does not fail the navigation. Scoped to
      // the page body on purpose: Next renders an always-present, empty `role="alert"` route announcer
      // outside it, which an unscoped assertion would match on every page.
      await expect(page.locator("main [role=alert]")).toHaveCount(0);

      await page.waitForLoadState("networkidle");
      watch.assertClean();
    });
  }

  test("the sidebar links to every section an owner can use", async ({ page }) => {
    await page.goto("/dashboard");
    const nav = page.getByRole("navigation").first();
    for (const [path] of ROUTES) {
      await expect(nav.locator(`a[href="${path}"]`), `sidebar link to ${path}`).toHaveCount(1);
    }
  });
});

test.describe("admin access control", () => {
  test("a signed-out browser is sent to the sign-in page", async ({ browser }) => {
    // The console runs on the same origin as the catalogue tooling and shows every account's data; an
    // unauthenticated session reaching a route at all is the whole of the boundary.
    // Explicitly empty: a context created from the shared browser can still carry the signed-in state this
    // project stores, and a boundary test that quietly runs as an admin proves the opposite of its name.
    const fresh = await browser.newContext({ baseURL: ADMIN_URL, storageState: { cookies: [], origins: [] } });
    const page = await fresh.newPage();

    await page.goto("/users");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: "Katha Admin" })).toBeVisible();

    await fresh.close();
  });

  test("an unknown path does not fall through to a page", async ({ page }) => {
    // Access is deny-by-default: a path that matches no known section must not render an admin screen.
    await page.goto("/definitely-not-a-section");
    await expect(page).not.toHaveURL(/definitely-not-a-section/);
  });

  test("signing in with the wrong password is refused", async ({ browser }) => {
    const fresh = await browser.newContext({ baseURL: ADMIN_URL, storageState: { cookies: [], origins: [] } });
    const page = await fresh.newPage();

    await page.goto("/login");
    await page.getByLabel("Email").fill("e2e-admin@katha.e2e");
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.locator("form [role=alert]")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);

    await fresh.close();
  });
});
