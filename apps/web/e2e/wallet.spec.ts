import { expect, test } from "@playwright/test";

/** The wallet needs a session: seed the token store the way a real sign-in would. */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "katha.tokens",
      JSON.stringify({ access_token: "e2e-access", refresh_token: "e2e-refresh", expires_at: Date.now() + 3_600_000 }),
    );
  });
});

test.describe("wallet", () => {
  test("lists coin packs and the eligible offer", async ({ page }) => {
    await page.goto("/wallet");

    await expect(page.getByRole("heading", { level: 1, name: "Wallet" })).toBeVisible();
    await expect(page.getByText("120", { exact: true }).first()).toBeVisible();

    // Offers with their discount and countdown.
    await expect(page.getByRole("heading", { name: "Offers" })).toBeVisible();
    const offer = page.getByRole("button", { name: /First purchase bonus/ });
    await expect(offer).toBeVisible();
    await expect(offer).toContainText("20% off");
    await expect(offer).toContainText(/Ends in/);

    // Packs.
    await expect(page.getByText("Starter")).toBeVisible();
    await expect(page.getByText("Binge")).toBeVisible();
    await expect(page.getByRole("button", { name: /₹99/ })).toBeVisible();

    // A coupon plus the offer produce a priced confirmation before the redirect.
    await page.getByLabel("Coupon code").fill("KATHA20");
    await offer.click();
    await page.getByRole("button", { name: /₹499/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Your discount is applied");
    await expect(dialog).toContainText("20% off");
    await expect(dialog.getByRole("button", { name: "Continue to payment" })).toBeVisible();
  });

  test("an unknown coupon is reported on the field", async ({ page }) => {
    await page.goto("/wallet");
    await page.getByLabel("Coupon code").fill("NOPE");
    await page.getByRole("button", { name: /₹99/ }).click();
    await expect(page.getByText("That code doesn't exist. Check the spelling and try again.")).toBeVisible();
  });
});
