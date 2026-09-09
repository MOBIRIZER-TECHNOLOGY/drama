import { expect, type Page, type Response } from "@playwright/test";

/**
 * Watch a page for the failures that do not raise anything a test would otherwise notice.
 *
 * A blocked image, a 500 on a background fetch and a CSP violation all leave the page looking plausible:
 * assertions on headings still pass, and the product is broken. This is how the CSP that blocked every cover
 * and every video segment survived — the pages rendered, so nothing failed.
 *
 * `ignore` takes substrings for the noise a given page legitimately produces.
 */
export function watchForBrokenResources(page: Page, { ignore = [] as string[] } = {}) {
  const problems: string[] = [];
  const allowed = (s: string) => ignore.some((i) => s.includes(i));

  page.on("console", (msg) => {
    const text = msg.text();
    if (msg.type() !== "error") return;
    if (allowed(text)) return;
    // Chromium reports a CSP refusal as a console error and nothing else: no failed request, no exception.
    if (/Content Security Policy/i.test(text)) problems.push(`CSP: ${text.slice(0, 200)}`);
  });

  page.on("requestfailed", (req) => {
    const url = req.url();
    if (allowed(url)) return;
    const why = req.failure()?.errorText ?? "";
    // Navigations the test itself cancels (a click during load) are not defects.
    if (why.includes("ERR_ABORTED")) return;
    problems.push(`${why} ${url}`);
  });

  page.on("response", (res: Response) => {
    const url = res.url();
    if (allowed(url)) return;
    if (res.status() >= 400) problems.push(`HTTP ${res.status()} ${url}`);
  });

  return {
    /** Assert nothing broke. Call at the end of a spec, after the page has settled. */
    assertClean() {
      expect(problems.map((p) => p.slice(0, 160)), "no broken resources on this page").toEqual([]);
    },
    problems,
  };
}

/** Wait for a `<video>` to actually decode, not merely exist: `currentTime` has to move. */
export async function expectVideoAdvances(page: Page, selector = "video") {
  const video = page.locator(selector).first();
  await expect(video).toBeAttached();
  await expect
    .poll(
      async () => video.evaluate((v: HTMLVideoElement) => (v.readyState >= 2 ? v.currentTime : -1)),
      {
        message: "the video should buffer and start advancing",
        timeout: 30_000,
        intervals: [500],
      },
    )
    .toBeGreaterThan(0.05);
}

/** Digits out of a label like "5,000" or "₹1,299". Used for balances the UI formats. */
export function digits(text: string | null): number {
  return Number((text ?? "").replace(/[^\d]/g, ""));
}
