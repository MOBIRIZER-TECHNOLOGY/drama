import { expect, test } from "@playwright/test";
import { expectVideoAdvances, watchForBrokenResources } from "../support/checks";

/**
 * Playback, end to end, against encrypted media.
 *
 * Everything between "the page rendered" and "the viewer is watching" is invisible to a test that only
 * asserts on markup: the signed manifest, the variant playlist, the AES key the player fetches separately,
 * the segments, and CORS on all of them. Any one of those failing leaves a page that looks correct with a
 * video that never starts — which is exactly what a blocked CSP produced here, and what a media host without
 * CORS produced after that.
 */
test.describe("playback", () => {
  test("a free episode streams and the video actually advances", async ({ page }) => {
    const watch = watchForBrokenResources(page);
    await page.goto("/en/series/ashes-of-lucknow?ep=1");

    await expect(page.getByRole("heading", { level: 1, name: "Ashes of Lucknow" })).toBeVisible();
    // Not `toBeVisible` on the <video>: an element that exists and never decodes is the failure being
    // guarded against, so this waits for currentTime to move.
    await expectVideoAdvances(page);

    watch.assertClean();
  });

  test("the player fetches a signed manifest, its variant and the decryption key", async ({ page }) => {
    // The three-request shape of AES-128 HLS. If the key request stops being made the stream is in the
    // clear; if it starts failing the segments decrypt to noise, and neither shows up as a broken page.
    const seen: { url: string; status: number }[] = [];
    page.on("response", (r) => {
      if (r.url().includes("/v1/stream/")) seen.push({ url: r.url(), status: r.status() });
    });

    await page.goto("/en/series/ashes-of-lucknow?ep=1");
    await expectVideoAdvances(page);

    const kinds = {
      master: seen.filter((s) => s.url.includes("master.m3u8")),
      variant: seen.filter((s) => /\/v\/[^/]+\/index\.m3u8/.test(s.url)),
      key: seen.filter((s) => s.url.includes("/key?")),
    };
    expect(kinds.master.length, "the master manifest should be fetched").toBeGreaterThan(0);
    expect(kinds.variant.length, "a rendition playlist should be fetched").toBeGreaterThan(0);
    expect(kinds.key.length, "the content key should be fetched — without it the media is not encrypted").toBeGreaterThan(0);
    expect(seen.filter((s) => s.status >= 400), "every stream request should succeed").toEqual([]);
  });

  test("the manifest is not reachable without its signature", async ({ page, request }) => {
    // The signature is the paywall. Serving the manifest unsigned would make every earlier check decorative.
    const urls: string[] = [];
    page.on("response", (r) => {
      if (r.url().includes("master.m3u8")) urls.push(r.url());
    });
    await page.goto("/en/series/ashes-of-lucknow?ep=1");
    await expectVideoAdvances(page);
    expect(urls.length).toBeGreaterThan(0);

    const unsigned = urls[0].split("?")[0];
    const res = await request.get(unsigned);
    expect(res.status(), "an unsigned manifest URL must be refused").toBeGreaterThanOrEqual(400);
  });

  test("watch progress is recorded so the episode can be resumed", async ({ page }) => {
    const progress: number[] = [];
    page.on("response", (r) => {
      if (r.url().includes("/progress")) progress.push(r.status());
    });

    await page.goto("/en/series/ashes-of-lucknow?ep=1");
    await expectVideoAdvances(page);
    await page.waitForTimeout(2000);

    expect(progress.length, "progress should be reported while watching").toBeGreaterThan(0);
    expect(progress.every((s) => s < 400), `progress calls returned ${progress}`).toBe(true);
  });

  test("the player controls are reachable by their accessible names", async ({ page }) => {
    // These are the only labels a screen reader or a keyboard user has; they are also the ones most easily
    // lost in a refactor, because the buttons are icons and look fine without them.
    await page.goto("/en/series/ashes-of-lucknow?ep=1");
    await expectVideoAdvances(page);

    for (const name of ["Back 10 seconds", "Forward 10 seconds", "Mute", "Fullscreen"]) {
      await expect(page.getByRole("button", { name }), `control "${name}"`).toBeVisible();
    }
    // Play/pause has two controls with the same name — the big one over the picture and the one in the
    // control bar — and the name reflects state, so this asserts that at least one is reachable rather than
    // pinning which.
    const playPause = page.getByRole("button", { name: /^(Pause|Play)$/ });
    await expect(playPause.first()).toBeVisible();
    expect(await playPause.count()).toBeGreaterThan(0);
  });
});
