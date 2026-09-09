import { expect, request, test as setup } from "@playwright/test";
import { ADMIN_STATE, ADMIN_URL, API_URL, seed, WEB_STATE, WEB_URL, webTokens } from "./support/fixture";

setup("the stack is up", async () => {
  // Checked first and separately: every other failure in this file is ambiguous if a server is simply down,
  // and "connection refused" three layers into a browser context is a bad way to learn that.
  const api = await request.newContext();
  for (const [name, url] of [
    ["API", `${API_URL}/health`],
    ["web", WEB_URL],
    ["admin", ADMIN_URL],
  ] as const) {
    let res;
    try {
      res = await api.get(url, { timeout: 15_000 });
    } catch (cause) {
      throw new Error(`${name} is not reachable at ${url}. Start the stack before running the E2E suite.`, { cause });
    }
    expect(res.status(), `${name} at ${url} answered ${res.status()}`).toBeLessThan(400);
  }
  await api.dispose();
});

setup("seed the fixture accounts", async ({ browser }) => {
  const fixture = seed();

  // Web: the session is injected rather than performed, because signing in goes through Firebase. The token
  // is a real one minted by the API, so everything after this point is the genuine authenticated app.
  const web = await browser.newContext({ baseURL: WEB_URL });
  await web.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    ["katha.tokens", webTokens(fixture)] as const,
  );
  const webPage = await web.newPage();
  await webPage.goto("/en");
  await webPage.waitForLoadState("domcontentloaded");
  await web.storageState({ path: WEB_STATE });
  await web.close();

  // Admin has its own email/password login, so it is performed for real: this is the only place the login
  // form is exercised, and a break in it should fail the whole admin suite rather than one spec.
  const admin = await browser.newContext({ baseURL: ADMIN_URL });
  const adminPage = await admin.newPage();
  await adminPage.goto("/login");
  await adminPage.getByLabel("Email").fill(fixture.admin.email);
  await adminPage.getByLabel("Password").fill(fixture.admin.password);
  await adminPage.getByRole("button", { name: "Sign in" }).click();
  await expect(adminPage).toHaveURL(/\/(dashboard)?$/, { timeout: 30_000 });
  await admin.storageState({ path: ADMIN_STATE });
  await admin.close();
});
