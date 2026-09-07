import { expect, test } from "@playwright/test";
import { API_URL } from "../playwright.config";

type MockRequest = { method: string; path: string; body: unknown; authed: boolean };

async function mockRequests(request: { get: (url: string) => Promise<{ json: () => Promise<MockRequest[]> }> }) {
  const res = await request.get(`${API_URL}/__requests`);
  return res.json();
}

test.describe("guest playback", () => {
  test("a guest plays the free first episode", async ({ page, request }) => {
    await request.get(`${API_URL}/__reset`);
    await page.goto("/series/midnight-heiress");

    await expect(page.getByRole("heading", { level: 1, name: "Midnight Heiress" })).toBeVisible();

    // The playback grant is requested without a session and the player mounts with the returned source.
    const video = page.locator("video");
    await expect(video).toBeVisible();

    await expect
      .poll(async () => {
        const calls = await mockRequests(request);
        return calls.some((c) => c.method === "POST" && /\/v1\/episodes\/.+\/play$/.test(c.path) && !c.authed);
      })
      .toBe(true);

    // Product and QoE beacons are batched to /v1/events; play_start is emitted when the source attaches.
    await expect
      .poll(
        async () => {
          const calls = await mockRequests(request);
          const events = calls
            .filter((c) => c.path === "/v1/events" && c.body && typeof c.body === "object")
            .flatMap((c) => ((c.body as { events?: { name: string }[] }).events ?? []).map((e) => e.name));
          return events;
        },
        { timeout: 20_000 },
      )
      .toEqual(expect.arrayContaining(["series_view", "play_start"]));
  });

  test("the shorts feed plays the first episode of the first card", async ({ page }) => {
    await page.goto("/shorts");
    await expect(page.getByRole("link", { name: "Midnight Heiress" }).first()).toBeVisible();
    await expect(page.locator("video")).toBeVisible();
    await expect(page.getByRole("link", { name: "Watch full" }).first()).toHaveAttribute("href", /\/series\/midnight-heiress\?ep=1$/);
  });
});
