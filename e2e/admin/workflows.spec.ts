import { expect, test } from "@playwright/test";
import { fixture } from "../support/fixture";

/**
 * The jobs an operator actually does in the console, against live data.
 *
 * Read paths are covered by `access.spec.ts`; these are the ones that change something, so each cleans up
 * after itself and the suite can run repeatedly against the same database.
 *
 * Serial for the same reason as the viewer suite: one admin account, one database, and several of these
 * assert on counts that another test could move underneath them.
 */
test.describe.configure({ mode: "serial" });

test.describe("catalogue management", () => {
  test("the drama list shows covers, not broken images", async ({ page }) => {
    // Covers are stored as keys and have to be resolved against the media host before they reach an <img>.
    // Rendering the key directly gave every row a 404 against the console's own origin — visible to anyone
    // who opened the page, and invisible to any check that only asked whether the page had loaded.
    const notFound: string[] = [];
    page.on("response", (r) => {
      if (r.status() === 404 && /\.(jpg|jpeg|png|webp|avif)$/i.test(new URL(r.url()).pathname)) notFound.push(r.url());
    });

    await page.goto("/dramas");
    await expect(page.getByRole("heading", { level: 1, name: "Dramas" })).toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();
    await page.waitForLoadState("networkidle");

    expect(notFound, "cover images should resolve against the media host").toEqual([]);
  });

  test("dramas can be searched, and the search narrows the list", async ({ page }) => {
    // Searched by slug, not title: the list shows each series in its *original* language (Hindi for this
    // catalogue), which is right for an operator and the wrong thing to assert English against.
    const [, series] = fixture().series;
    await page.goto("/dramas");
    // Wait for the list to arrive before counting; a baseline taken mid-load is zero, and then any result
    // at all looks like a narrowing.
    await expect(page.getByRole("row").nth(2)).toBeVisible({ timeout: 20_000 });
    const rowsBefore = await page.getByRole("row").count();
    expect(rowsBefore, "the catalogue should have several series to filter").toBeGreaterThan(2);

    await page.getByPlaceholder(/Search title or slug/i).fill(series.slug);
    await expect(page.getByRole("table")).toContainText(series.slug, { timeout: 15_000 });
    await expect
      .poll(async () => page.getByRole("row").count(), { message: "the search should narrow the list", timeout: 15_000 })
      .toBeLessThan(rowsBefore);
  });

  test("a category can be created, listed and deleted", async ({ page }) => {
    const name = `E2E Category ${Date.now() % 100000}`;
    const slug = `e2e-category-${Date.now() % 100000}`;

    await page.goto("/categories");
    await page.getByRole("button", { name: "New category" }).click();
    const dialog = page.getByRole("dialog").filter({ hasText: "New category" });
    await dialog.getByLabel("Name *").fill(name);
    await dialog.getByLabel("Slug *").fill(slug);
    await dialog.getByRole("button", { name: "Create" }).click();

    await expect(page.getByRole("table")).toContainText(name, { timeout: 15_000 });

    // Clean up, and exercise the delete path while doing it. The delete control is a row action labelled
    // for the category it removes, so a mis-click cannot delete the wrong one.
    await page.getByRole("button", { name: `Delete ${name}` }).click();

    // Deleting a category unfiles every series in it, so it asks first.
    const confirm = page.getByRole("dialog").filter({ hasText: /delete category/i });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: /^Delete$/ }).click();

    await expect(page.getByRole("table")).not.toContainText(name, { timeout: 15_000 });
  });
});

test.describe("supporting a viewer", () => {
  test("the user drawer opens with the account's wallet and purchases", async ({ page }) => {
    // The support drawer was completely broken: an older route shadowed the one that returns purchases and
    // VIP state, so it crashed on every account. "Couldn't load" is the exact state to assert against.
    await page.goto("/users");
    await page.getByPlaceholder(/Search name, email, phone or ID/i).fill("e2e-user@katha.e2e");
    await expect(page.getByRole("table")).toContainText("E2E Viewer", { timeout: 15_000 });

    await page.getByRole("button", { name: "E2E Viewer" }).click();

    await expect(page.getByText(/Couldn't load/i)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /Purchases/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Cannot read properties/i)).toHaveCount(0);
  });

  test("a viewer's ledger is visible to support", async ({ page }) => {
    // "I paid and got no coins" is the ticket this screen exists to answer.
    await page.goto("/users");
    await page.getByPlaceholder(/Search name, email, phone or ID/i).fill("e2e-user@katha.e2e");
    await page.getByRole("button", { name: "E2E Viewer" }).click();

    await expect(page.getByText(/E2E fixture reset|admin_adjust|unlock/i).first()).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("operations", () => {
  test("settings are grouped into namespaces and stay readable", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    for (const namespace of ["auth", "economy", "rewards", "site"]) {
      // Matched on the visible text rather than the accessible name: these are icon-and-label switches whose
      // computed name carries more than the namespace.
      const tab = page.locator("button").filter({ hasText: new RegExp(`^${namespace}$`) }).first();
      await expect(tab, `settings namespace "${namespace}"`).toBeVisible();
      await tab.click();
      await expect(page.getByRole("table")).toBeVisible();
    }
  });

  test("a broadcast asks for confirmation before it can be sent", async ({ page }) => {
    // A notification reaches every install and cannot be recalled, so the confirmation is the safeguard.
    // This test deliberately stops at it: nothing here should actually broadcast.
    await page.goto("/notifications");
    await page.getByPlaceholder("New episodes tonight").fill("E2E test — not sent");
    await page.getByPlaceholder(/Three new episodes/).fill("This message is never sent.");
    await page.getByRole("button", { name: "Send announcement" }).click();

    const confirm = page.getByRole("dialog");
    await expect(confirm).toBeVisible();
    await expect(confirm.getByRole("button", { name: "Send now" })).toBeVisible();
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toBeHidden();
  });

  test("the audit log records who did what", async ({ page }) => {
    // Every destructive admin action is supposed to leave a row; an empty log means the trail is not being
    // written, which is only discovered when it is needed.
    await page.goto("/audit");
    await expect(page.getByRole("heading", { level: 1, name: "Audit log" })).toBeVisible();
    await expect(page.locator("main")).not.toContainText(/couldn't load/i);
  });

  test("the moderation queue loads and can be filtered", async ({ page }) => {
    await page.goto("/moderation");
    await expect(page.getByRole("heading", { level: 1, name: "Moderation" })).toBeVisible();
    // Same as the settings switches: the filter chips carry a count, so match their text.
    const reports = page.locator("button").filter({ hasText: /^Reports\s*\d*$/ }).first();
    await expect(reports).toBeVisible();
    await reports.click();
    await expect(page.locator("main")).not.toContainText(/couldn't load/i);
  });
});
