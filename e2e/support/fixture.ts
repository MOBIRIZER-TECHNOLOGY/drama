import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

// Playwright transpiles the config and its imports to CommonJS, so `import.meta.url` is not available here.
export const ROOT = resolve(__dirname, "..");
export const REPO = resolve(ROOT, "..");
export const STATE_DIR = join(ROOT, ".auth");
export const FIXTURE_FILE = join(STATE_DIR, "fixture.json");
export const WEB_STATE = join(STATE_DIR, "web.json");
export const ADMIN_STATE = join(STATE_DIR, "admin.json");

export const WEB_URL = process.env.E2E_WEB_URL ?? "http://localhost:3000";
export const ADMIN_URL = process.env.E2E_ADMIN_URL ?? "http://localhost:3001";
export const API_URL = process.env.E2E_API_URL ?? "http://127.0.0.1:8001";

/** What `scripts/seed_e2e.py --json` hands back. */
export type Fixture = {
  admin: { email: string; password: string };
  user: {
    email: string;
    public_id: string;
    coin_balance: number;
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  series: { slug: string; title: string }[];
};

/**
 * Run the API's fixture seeder and cache what it prints.
 *
 * The seeder is Python because it needs the models and the token signer, and reaching for those from the
 * test runner would mean re-implementing both. It is invoked through the API's own virtualenv rather than a
 * global `python`, so the suite does not depend on whatever happens to be first on PATH.
 */
export function seed(): Fixture {
  const api = join(REPO, "services", "api");
  const venv = join(api, ".venv", "Scripts", "python.exe");
  const python = existsSync(venv) ? venv : join(api, ".venv", "bin", "python");
  if (!existsSync(python)) {
    throw new Error(
      `No API virtualenv at ${python}. Run \`uv sync\` in services/api first — the E2E suite seeds its ` +
        `accounts through the API's own models.`,
    );
  }
  const out = execFileSync(python, [join("scripts", "seed_e2e.py"), "--json"], {
    cwd: api,
    encoding: "utf8",
    // Inherit stderr so a database that is down reports itself, instead of surfacing as a JSON parse error.
    stdio: ["ignore", "pipe", "inherit"],
  });
  const fixture = JSON.parse(out.trim()) as Fixture;
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(FIXTURE_FILE, JSON.stringify(fixture, null, 2), "utf8");
  return fixture;
}

/** Read the fixture the setup project wrote. Specs use this; only setup calls `seed()`. */
export function fixture(): Fixture {
  if (!existsSync(FIXTURE_FILE)) {
    throw new Error(`No fixture at ${FIXTURE_FILE}. The "setup" project should have written it.`);
  }
  return JSON.parse(readFileSync(FIXTURE_FILE, "utf8")) as Fixture;
}

/** The shape `apps/web/src/lib/token-store.ts` reads out of localStorage. */
export function webTokens(f: Fixture) {
  return JSON.stringify({
    access_token: f.user.access_token,
    refresh_token: f.user.refresh_token,
    expires_at: Date.now() + f.user.expires_in * 1000,
  });
}
