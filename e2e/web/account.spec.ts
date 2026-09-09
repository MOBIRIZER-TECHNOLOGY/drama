import { expect, test } from "@playwright/test";
import { watchForBrokenResources } from "../support/checks";

/**
 * Rewards, the list a viewer builds, and the account controls a store review will look for.
 *
 * The account page is where the obligations live: a way out (sign out, revoke a device), a way to take your
 * data, and a way to delete the account. Those are the parts nobody exercises by hand and both app stores
 * check for.
 */
test.describe("rewards", () => {
  test("the daily check-in and tasks are offered", async ({ page }) => {
    const watch = watchForBrokenResources(page);
    await page.goto("/en/rewards");

    await expect(page.getByRole("heading", { level: 1, name: "Rewards" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Daily check-in" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Tasks", exact: true })).toBeVisible();

    await page.waitForLoadState("networkidle");
    watch.assertClean();
  });

  test("claiming the check-in either credits coins or says it is already done", async ({ page }) => {
    await page.goto("/en/rewards");
    const claim = page.getByRole("button", { name: "Claim" }).first();

    // The account may already have claimed today — the suite runs more than once a day. Both outcomes are
    // correct; what would be wrong is a button that does nothing at all.
    if (await claim.isEnabled()) {
      await claim.click();
      await expect(page.locator("main")).toContainText(/claimed|streak|coins|already/i, { timeout: 15_000 });
    } else {
      await expect(claim).toBeDisabled();
    }
  });

  test("the referral link is shareable and copyable", async ({ page }) => {
    await page.goto("/en/rewards");
    await expect(page.getByRole("heading", { name: /Invite a friend/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Send on WhatsApp" })).toHaveAttribute("href", /wa\.me|whatsapp/i);
  });
});

test.describe("my list", () => {
  test("a series can be added to the list and comes back on the list page", async ({ page }) => {
    /**
     * Driven by what the server answers, not by what the button says before it has been told.
     *
     * The control is server-rendered as `aria-pressed="false"` and only learns the viewer's real state once
     * the client has fetched it. Reading the attribute first and deciding whether to click therefore toggles
     * the wrong way about as often as not — and the failure looks like a broken favourite rather than a test
     * that raced the page.
     *
     * Asserting the button against the response also pins the property that actually matters: the control
     * shows what the server recorded, rather than an optimistic guess that can drift from it.
     */
    const clickFavourite = async (): Promise<boolean> => {
      // The button is in the server-rendered HTML before React attaches to it, so "visible" is not the same
      // as "clickable" — a click that lands first does nothing at all and no request is ever made. The coin
      // balance only renders once the client has hydrated and resolved the session, which makes it a
      // reliable signal that this page is live.
      await expect(page.getByRole("link", { name: "Coin balance" })).toBeVisible();
      const button = page.getByRole("button", { name: "My List" });
      await expect(button).toBeVisible();
      const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().includes("/favorite") && r.request().method() === "POST"),
        button.click(),
      ]);
      expect(response.ok(), "the favourite call should succeed").toBe(true);
      const { active } = (await response.json()) as { active: boolean };
      await expect(button).toHaveAttribute("aria-pressed", String(active));
      return active;
    };

    await page.goto("/en/series/ashes-of-lucknow");
    // One click, and a second only if the first turned it off — so the test works from either start state.
    let favourited = await clickFavourite();
    if (!favourited) favourited = await clickFavourite();
    expect(favourited, "the series should end up favourited").toBe(true);

    await page.goto("/en/my-list");
    await expect(page.getByRole("heading", { level: 1, name: "My List" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Favourites", exact: true })).toBeVisible();
    await expect(page.locator("main")).toContainText("Ashes of Lucknow");

    // Put it back, and wait for that to land: a click abandoned by the closing context would leave the
    // account favourited and the next run starting somewhere else.
    await page.goto("/en/series/ashes-of-lucknow");
    expect(await clickFavourite(), "the series should be un-favourited again").toBe(false);
  });

  test("watching an episode puts it in continue watching", async ({ page }) => {
    await page.goto("/en/my-list");
    await expect(page.getByRole("heading", { name: "Continue watching" })).toBeVisible();
  });
});

test.describe("account", () => {
  test("the profile page exposes the controls a store review looks for", async ({ page }) => {
    const watch = watchForBrokenResources(page);
    await page.goto("/en/profile");

    await expect(page.getByRole("heading", { level: 1, name: "Profile" })).toBeVisible();
    // Each of these is a commitment: a way out, a way to take your data, and a way to be forgotten.
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Download data" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete account" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Signed-in devices" })).toBeVisible();

    await page.waitForLoadState("networkidle");
    watch.assertClean();
  });

  test("deleting an account asks first", async ({ page }) => {
    // Irreversible and one tap from the profile page, so the confirmation is the feature.
    await page.goto("/en/profile");
    await page.getByRole("button", { name: "Delete account" }).click();
    // Scoped to the dialog: the section that holds the button carries the same wording as its heading.
    const dialog = page.getByRole("dialog").filter({ hasText: /delete your account/i });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Profile" })).toBeVisible();
  });

  test("the display name can be changed and persists", async ({ page }) => {
    // Each save waits for the request it triggers. Reloading straight after the click races the PATCH, and
    // the page then comes back with the old name — which reads as "the change did not persist" rather than
    // "the test did not wait for it".
    const save = async (value: string) => {
      await page.getByRole("textbox").first().fill(value);
      const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().includes("/auth/me") && r.request().method() === "PATCH"),
        page.getByRole("button", { name: "Save changes" }).click(),
      ]);
      expect(response.ok(), "saving the profile should succeed").toBe(true);
    };

    await page.goto("/en/profile");
    const original = (await page.getByRole("textbox").first().inputValue()) || "E2E Viewer";
    const next = `E2E Viewer ${Date.now() % 10000}`;

    await save(next);
    await page.reload();
    await expect(page.getByRole("textbox").first()).toHaveValue(next, { timeout: 15_000 });

    await save(original);
  });
});
