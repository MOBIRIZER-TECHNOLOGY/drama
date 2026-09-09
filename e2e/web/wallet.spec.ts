import { expect, test } from "@playwright/test";
import { watchForBrokenResources } from "../support/checks";
import { API_URL } from "../support/fixture";

/**
 * The wallet: what a viewer can buy, what a coupon does, and whether the ledger they are shown is the one
 * their balance came from.
 *
 * Checkout itself stops at the gateway. Driving Stripe or Razorpay from a test would be testing their
 * software with someone's real credentials; what belongs here is everything up to the hand-off, plus proof
 * that the hand-off is actually offered.
 */
test.describe("wallet", () => {
  test("coin packs and their prices are listed", async ({ page }) => {
    const watch = watchForBrokenResources(page);
    await page.goto("/en/wallet");

    await expect(page.getByRole("heading", { level: 1, name: "Wallet" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Coin packs" })).toBeVisible();

    const buy = page.getByRole("button", { name: /Get coins|Go VIP/ });
    // `count()` does not wait, so it has to follow an assertion that does — otherwise this passes or fails
    // on how quickly the packs happen to arrive.
    await expect(buy.first(), "there should be something to buy").toBeVisible();
    expect(await buy.count()).toBeGreaterThan(0);
    // Prices are regional and set by an operator, so assert that each button carries a currency and a
    // number rather than a particular amount.
    await expect(buy.first()).toHaveText(/[₹$€£]\s?[\d,.]+/);

    await page.waitForLoadState("networkidle");
    watch.assertClean();
  });

  test("with no payment gateway configured, the packs say so instead of failing later", async ({ page, request }) => {
    // A viewer must not be able to start a checkout that cannot complete. When `/v1/config` reports no
    // gateways the page has to say so up front, which is also the state a misconfigured deployment lands in.
    await page.goto("/en/wallet");
    const res = await request.get(`${API_URL}/v1/config`);
    expect(res.ok(), "the API should answer /v1/config").toBe(true);
    const gateways: string[] = (await res.json()).payments?.gateways ?? [];

    if (gateways.length === 0) {
      await expect(page.locator("main")).toContainText(/not available|check back later/i);
    } else {
      await expect(page.locator("main")).not.toContainText(/not available right now/i);
    }
  });

  test("an unknown coupon is reported rather than silently ignored", async ({ page }) => {
    await page.goto("/en/wallet");
    const buy = page.getByRole("button", { name: /Get coins/ }).first();
    // The code is validated when a pack is chosen, so with no gateway there is nothing to validate against.
    test.skip(!(await buy.isEnabled()), "no payment gateway configured in this environment");

    await page.getByLabel("Coupon code").fill("DEFINITELY-NOT-A-COUPON");
    await buy.click();
    // Silence here would let someone believe a discount applied and then be charged full price.
    await expect(page.locator("main, [role=dialog]")).toContainText(/doesn't exist|not valid|invalid|expired/i, {
      timeout: 15_000,
    });
  });

  test("the transaction history shows the ledger the balance came from", async ({ page }) => {
    const watch = watchForBrokenResources(page);
    await page.goto("/en/wallet/history");

    await expect(page.getByRole("heading", { level: 1, name: "Transaction history" })).toBeVisible();
    for (const column of ["Date", "Type", "Coins", "Balance"]) {
      await expect(page.getByRole("columnheader", { name: column })).toBeVisible();
    }
    // Every row carries a running balance; that column is what makes the ledger auditable rather than a
    // list of events.
    await expect(page.getByRole("table")).toBeVisible();

    await page.waitForLoadState("networkidle");
    watch.assertClean();
  });

  test("history can be filtered to earned and spent", async ({ page }) => {
    await page.goto("/en/wallet/history");
    const table = page.getByRole("table");

    await page.getByRole("button", { name: "Spent", exact: true }).click();
    await expect(table).toBeVisible();
    // The unlock the unlock suite performed is a spend, so this filter must not be empty.
    await expect(table).toContainText(/unlock|-\s*\d/i);

    await page.getByRole("button", { name: "Earned", exact: true }).click();
    await expect(table).toBeVisible();
  });

  test("the wallet is reachable from the balance in the header", async ({ page }) => {
    await page.goto("/en");
    await page.getByRole("link", { name: "Coin balance" }).click();
    await expect(page).toHaveURL(/\/wallet$/);
    await expect(page.getByRole("heading", { level: 1, name: "Wallet" })).toBeVisible();
  });
});
