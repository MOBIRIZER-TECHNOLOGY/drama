import { expect, test } from "@playwright/test";
import { digits } from "../support/checks";

/**
 * Spending coins on an episode — the one flow where a bug costs a viewer money.
 *
 * The fixture clears this account's unlocks and resets its balance before every run, so the second episode
 * of the seeded series always starts locked and the arithmetic is checkable.
 *
 * Serial, because these tests share one account's balance: run against each other they would race, and the
 * assertions on the new balance would be meaningless.
 */
test.describe.configure({ mode: "serial" });

/** The confirm control in the unlock sheet. Named apart from the episode button, which carries the same
 * "Unlock for N coins" wording — only the sheet's button also states the balance it is about to change. */
function confirmButton(page: import("@playwright/test").Page) {
  return page
    .getByRole("button")
    .filter({ hasText: /Unlock for \d+ coins/ })
    .filter({ hasText: /Balance/ });
}

test.describe("unlocking an episode", () => {
  test("a locked episode costs coins, opens, and shows on the balance", async ({ page }) => {
    await page.goto("/en/series/ashes-of-lucknow");

    const balance = page.getByRole("link", { name: "Coin balance" });
    const before = digits(await balance.textContent());
    expect(before, "the fixture starts this account with coins").toBeGreaterThan(0);

    const locked = page.getByRole("button", { name: /Episode \d+.*Unlock for \d+ coins/ }).first();
    await expect(locked).toBeVisible();
    const price = Number((await locked.getAttribute("aria-label"))?.match(/Unlock for (\d+) coins/)?.[1] ?? 0);
    expect(price).toBeGreaterThan(0);

    await locked.click();
    // Choosing a locked episode opens a sheet rather than spending straight away: coins are real money, and
    // a mis-tap on a thumbnail must not be able to spend them.
    const confirm = confirmButton(page);
    await expect(confirm).toBeVisible();
    // The sheet states the arithmetic before it happens, which is the part a viewer relies on.
    await expect(confirm).toHaveText(new RegExp(`${before - price}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",?")));
    await confirm.click();

    // The episode is now playable and the balance has gone down by exactly the price.
    await expect(page.getByRole("button", { name: /Episode 2.*(unlocked|free)/i })).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(async () => digits(await balance.textContent()), {
        message: "balance should drop by exactly the price",
        timeout: 15_000,
      })
      .toBe(before - price);
  });

  test("the spend is recorded in the ledger", async ({ page }) => {
    // The balance is derived from the ledger, so a spend that moves the number without writing a row leaves
    // a wallet that cannot be audited or refunded.
    await page.goto("/en/wallet/history");
    await expect(page.getByRole("heading", { name: "Transaction history" })).toBeVisible();
    await expect(page.getByRole("table")).toContainText(/unlock/i);
  });

  test("an already-unlocked episode plays without charging again", async ({ page }) => {
    await page.goto("/en/series/ashes-of-lucknow");
    const balance = page.getByRole("link", { name: "Coin balance" });
    const before = digits(await balance.textContent());

    await page.getByRole("button", { name: /^Episode 2/ }).click();
    await page.waitForTimeout(2500);

    await expect(confirmButton(page), "an unlocked episode must not ask to be paid for again").toHaveCount(0);
    expect(digits(await balance.textContent()), "replaying must not charge twice").toBe(before);
  });

  test("episodes unlock in order", async ({ page }) => {
    // Sequential unlocking is the rule the catalogue is priced around; skipping ahead would let someone buy
    // the finale without the episodes before it.
    await page.goto("/en/series/betrayal-in-delhi");
    const later = page.getByRole("button", { name: /Episode [3-9]/ }).first();
    if ((await later.count()) === 0) test.skip(true, "no deep episode in the seeded catalogue");

    await expect(page.locator("main")).toContainText(/unlock previous first|unlock next/i);
  });
});
