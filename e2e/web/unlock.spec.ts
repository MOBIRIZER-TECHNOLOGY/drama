import { expect, test } from "@playwright/test";
import { primarySeries, primaryWord } from "../support/fixture";
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
    await page.goto(`/en/series/${primarySeries().slug}`);

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
    await page.goto(`/en/series/${primarySeries().slug}`);
    const balance = page.getByRole("link", { name: "Coin balance" });
    // The balance only renders once the client has hydrated and resolved the session: the signal that the
    // page is live and the tiles below carry the viewer's own lock states rather than the anonymous ones.
    await expect(balance).toBeVisible();
    const before = digits(await balance.textContent());

    const episode2 = page.getByRole("button", { name: /^Episode 2/ });
    await expect(episode2).toHaveAccessibleName(/unlocked/i);
    // Choosing it asks the API for a playback grant, and that grant is the proof it plays: a 200 here means
    // the server agreed the episode is the viewer's, with no sheet and no charge in between.
    const [grant] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/play") && r.request().method() === "POST"),
      episode2.click(),
    ]);
    expect(grant.status(), "an unlocked episode should be granted playback").toBe(200);
    await expect(episode2).toHaveAttribute("aria-current", "true");

    await expect(confirmButton(page), "an unlocked episode must not ask to be paid for again").toHaveCount(0);
    await expect
      .poll(async () => digits(await balance.textContent()), { message: "replaying must not charge twice" })
      .toBe(before);
  });

  test("episodes unlock in order", async ({ page }) => {
    // Sequential unlocking is the rule the catalogue is priced around; skipping ahead would let someone buy
    // the finale without the episodes before it.
    await page.goto(`/en/series/${primarySeries().slug}`);
    await expect(page.getByRole("link", { name: "Coin balance" })).toBeVisible();
    const tiles = page.getByRole("button", { name: /^Episode \d+/ });
    await expect(tiles.first()).toBeVisible();

    // The one episode on offer is the first locked one; the tile after it is the one that must stay shut.
    //
    // Read and judged inside a single poll, because the grid is server-rendered before the viewer's unlocks
    // are known and re-renders when they arrive: taking the row in one render and asserting against another
    // reported episode three as both the offered one and the blocked one, which no render ever said.
    const rowState = async () => {
      const names = await tiles.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? ""));
      const offered = names.findIndex((n) => /Unlock for \d+ coins/.test(n));
      if (offered < 0 || offered + 1 >= names.length) return "nothing-beyond-the-lock";
      return /unlock previous episodes first/i.test(names[offered + 1]) ? "next-is-blocked" : `next-is: ${names[offered + 1]}`;
    };
    await expect
      .poll(rowState, { message: "the episode after the one on offer should refuse to be bought first", timeout: 15_000 })
      .toMatch(/^(next-is-blocked|nothing-beyond-the-lock)$/);
    if ((await rowState()) === "nothing-beyond-the-lock") test.skip(true, "no episode beyond the first lock in the seeded catalogue");

    const names = await tiles.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? ""));
    const offered = names.findIndex((n) => /Unlock for \d+ coins/.test(n));
    const later = tiles.nth(offered + 1);
    await expect(later).toHaveAccessibleName(/unlock previous episodes first/i);
    // Choosing it states the rule, as an alert in the sheet, rather than quietly charging for it.
    await later.click();
    // Scoped to the page body: Next renders an always-present, empty `role="alert"` route announcer outside it.
    await expect(page.locator("main").getByRole("alert")).toHaveText(/unlock previous episodes first/i);
  });
});
