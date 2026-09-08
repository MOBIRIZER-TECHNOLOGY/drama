/**
 * Guards the message catalogue against silent drift.
 *
 * Both clients read `ui_translations` from the same server table, keyed by string id. So a key that means
 * "Retry" on mobile and "Try again" on web is not two pieces of copy — it is one row that one platform will
 * silently rewrite the other's wording with the first time a translator edits it. This fails the build when a
 * shared key carries two different English strings, and when the extracted web catalogue is stale.
 *
 * Run: node scripts/check-i18n.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const webCatalogue = join(root, "apps", "web", "src", "i18n", "en.json");
const mobileSource = join(root, "apps", "mobile", "src", "hooks", "use-translations.ts");

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exitCode = 1;
}

// 1. The committed catalogue must match what the app actually says today.
//
// Compared with line endings normalised, and the original bytes put back when only those differ. Git checks
// this file out as CRLF wherever `core.autocrlf` is on, the extractor writes LF, and a raw string compare
// therefore failed on Windows after every fresh checkout — a stale-catalogue error for a file whose keys were
// all identical. The check is about content, not about which platform ran it.
const eol = (text) => text.split("\r\n").join("\n");
const before = readFileSync(webCatalogue, "utf8");
execFileSync(process.execPath, [join(root, "apps", "web", "scripts", "extract-i18n.mjs")], { stdio: "pipe" });
const after = readFileSync(webCatalogue, "utf8");
if (eol(before) !== eol(after)) {
  fail("apps/web/src/i18n/en.json is stale. Run: pnpm --filter web run i18n:extract");
} else if (before !== after) {
  // Same content, different endings: leave the working tree exactly as it was found.
  writeFileSync(webCatalogue, before);
}

// 2. Shared keys must agree on their English.
const web = JSON.parse(after);
const mobile = Object.fromEntries(
  [...readFileSync(mobileSource, "utf8").matchAll(/"([a-z0-9_.]+)":\s*\n?\s*"((?:[^"\\]|\\.)*)"/g)].map(([, k, v]) => [
    k,
    v.replace(/\\"/g, '"'),
  ]),
);

const clashes = Object.keys(mobile)
  .filter((k) => k in web && web[k] !== mobile[k])
  .map((k) => `  ${k}\n    web:    ${web[k]}\n    mobile: ${mobile[k]}`);

if (clashes.length) {
  fail(
    `${clashes.length} key(s) mean different things on web and mobile. Give them one wording, or give one of ` +
      `them its own key:\n\n${clashes.join("\n\n")}`,
  );
}

if (!process.exitCode) {
  const shared = Object.keys(mobile).filter((k) => k in web).length;
  console.log(`i18n ok — ${Object.keys(web).length} web keys, ${Object.keys(mobile).length} mobile, ${shared} shared and consistent`);
}
