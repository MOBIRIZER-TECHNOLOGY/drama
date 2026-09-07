import { expect, test } from "@playwright/test";

test.describe("series page", () => {
  test("shows free, unlockable and sequential lock states", async ({ page }) => {
    await page.goto("/series/midnight-heiress");

    await expect(page.getByRole("heading", { level: 1, name: "Midnight Heiress" })).toBeVisible();

    const episodes = page.getByRole("list", { name: "Episodes" }).getByRole("button");
    await expect(episodes).toHaveCount(3);

    // 1 is free, 2 is the next unlock, 3 needs the previous one first.
    await expect(episodes.nth(0)).toHaveAccessibleName(/Free/);
    await expect(episodes.nth(1)).toHaveAccessibleName(/Unlock for 30 coins/);
    await expect(episodes.nth(2)).toHaveAccessibleName(/Unlock previous episodes first/);

    // A guest picking a paid episode is asked to sign in rather than being shown a player.
    await episodes.nth(1).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("browse groups series by category and the category page paginates", async ({ page }) => {
    await page.goto("/series");
    await expect(page.getByRole("heading", { level: 1, name: "Browse all dramas" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Categories" }).getByRole("link", { name: "Romance" })).toBeVisible();

    await page.getByRole("navigation", { name: "Categories" }).getByRole("link", { name: "Romance" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Romance" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Midnight Heiress" }).first()).toBeVisible();

    // The mock returns nothing past the first page, so the empty state offers the way back.
    await page.goto("/category/romance?offset=40");
    await expect(page.getByRole("link", { name: "Previous" })).toBeVisible();
  });
});
