import { expect, test, type Browser, type Page } from "@playwright/test";
import { ADMIN_URL, fixture, type StaffRole } from "../support/fixture";

/** Where the console keeps its session; mirrored from apps/admin/src/lib/token.ts. */
const TOKEN_KEY = "katha_admin_token";
const SESSION_COOKIE = "katha_admin_session";

/**
 * The role boundary, from the side of the people who are not the owner.
 *
 * `access.spec.ts` proves every section opens for an owner, which exercises none of the permission checks:
 * the owner passes all of them by definition. This signs in as each of the other roles and holds the console
 * to the matrix in `apps/admin/src/lib/nav.ts` — an owner-only section must not render for them, a section
 * their role owns must, and the sidebar must not advertise what they cannot open.
 *
 * A forbidden path is refused twice over: `src/proxy.ts` redirects it to the dashboard before anything
 * renders, and the shell does the same client-side should a navigation get past the proxy. Both land on the
 * dashboard, so that is what a refusal is asserted as here.
 */
type Staff = Exclude<StaffRole, "owner">;

type RoleCase = {
  role: Staff;
  /** A section this role is allowed to use, and the heading that proves it rendered. */
  allowed: [path: string, heading: RegExp];
  /** Sections this role must not reach. */
  denied: string[];
};

/** Reserved for the owner outright; no other role may see them listed or open them. */
const OWNER_ONLY = ["/audit", "/accounts", "/notifications"];

const CASES: RoleCase[] = [
  { role: "editor", allowed: ["/dramas", /^Dramas$/], denied: [...OWNER_ONLY, "/settings", "/users", "/purchases"] },
  { role: "support", allowed: ["/users", /^Users$/], denied: [...OWNER_ONLY, "/settings", "/dramas", "/purchases"] },
  { role: "finance", allowed: ["/purchases", /^Purchases$/], denied: [...OWNER_ONLY, "/dramas", "/reports"] },
];

/**
 * Start a context signed in as one role, from a session the seeder minted rather than the login form.
 *
 * The form is exercised for real once, for the owner, in `global.setup.ts`. Signing three more roles in
 * through it — once per test — would trip the admin login's rate limit (five attempts a minute from one
 * address) and fail with a 429 that has nothing to do with permissions. The seeder mints a token per role
 * the same way the login route does, so the session is genuine; only the keystrokes are skipped.
 *
 * The project's stored state is the owner's, and a boundary test that quietly ran as the owner would prove
 * the opposite of its name — so the context starts explicitly empty and gets exactly one role's session.
 */
async function signInAs(browser: Browser, role: Staff) {
  const admins = fixture().admins;
  test.skip(!admins?.[role]?.token, "the fixture has no role sessions; re-run the setup project against a current seeder");
  const account = admins![role];

  const context = await browser.newContext({ baseURL: ADMIN_URL, storageState: { cookies: [], origins: [] } });
  const origin = new URL(ADMIN_URL);
  const claims = { exp: Math.floor(Date.now() / 1000) + account.expires_in, role: account.role };
  await context.addCookies([
    {
      name: SESSION_COOKIE,
      value: encodeURIComponent(JSON.stringify(claims)),
      domain: origin.hostname,
      path: "/",
      httpOnly: false,
      secure: origin.protocol === "https:",
      sameSite: "Lax",
    },
  ]);
  await context.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [TOKEN_KEY, account.token] as const);
  const page = await context.newPage();
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Dashboard$/);
  return { context, page };
}

/** Opening a forbidden section leaves the visitor on the dashboard, with the dashboard — not the section — on screen. */
async function expectDenied(page: Page, path: string) {
  await page.goto(path);
  await expect(page, `${path} should redirect away`).toHaveURL(/\/dashboard(\?|$)/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Dashboard$/);
}

for (const { role, allowed, denied } of CASES) {
  test.describe(`signed in as ${role}`, () => {
    test(`${role} is kept out of ${denied.join(", ")}`, async ({ browser }) => {
      const { context, page } = await signInAs(browser, role);
      for (const path of denied) await expectDenied(page, path);
      await context.close();
    });

    test(`${role} can open ${allowed[0]}`, async ({ browser }) => {
      const [path, heading] = allowed;
      const { context, page } = await signInAs(browser, role);
      await page.goto(path);

      await expect(page).toHaveURL(new RegExp(`${path}(/|\\?|$)`));
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
      // Same definition of "loaded" as the owner's route sweep: the data arrived, nothing errored, and a
      // real outcome — rows, a form, or an explicit empty state — is on screen.
      const main = page.locator("main");
      await expect(main.locator("[role=progressbar]")).toHaveCount(0, { timeout: 20_000 });
      await expect(main.locator("[role=alert]")).toHaveCount(0);
      await expect(main).not.toContainText(/couldn't load|something went wrong/i);
      // A screen counts as loaded when it shows its content in any of the shapes this console uses — a table,
      // a form, tabs, a status region, or a list, which is how the inbox renders messages — or when it says
      // plainly that there is nothing to show.
      const rendered = main.locator("table, form, [role=tablist], [role=status], ul li").or(main.getByText(/^(No |Nothing |Queue is clear|Inbox is empty)/));
      await expect(rendered.first(), `${path} should show data, a form or an empty state for ${role}`).toBeVisible();

      await context.close();
    });

    test(`${role}'s sidebar does not link to sections it cannot open`, async ({ browser }) => {
      const { context, page } = await signInAs(browser, role);
      const nav = page.getByRole("navigation", { name: "Sections" }).first();
      // The link the role does have proves the sidebar rendered for it; only then is an absence meaningful.
      await expect(nav.locator(`a[href="${allowed[0]}"]`), `sidebar link to ${allowed[0]}`).toHaveCount(1);
      for (const path of denied) {
        await expect(nav.locator(`a[href="${path}"]`), `no sidebar link to ${path}`).toHaveCount(0);
      }
      await context.close();
    });
  });
}
