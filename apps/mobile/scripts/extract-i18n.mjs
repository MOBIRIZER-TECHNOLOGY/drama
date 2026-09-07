/**
 * Export the mobile app's baked-in English map to src/i18n/en.json, so the API can seed it alongside the web
 * catalogue. Both clients read the same `ui_translations` table, and mobile has ~70 keys web does not.
 *
 * Run: pnpm --filter mobile run i18n:extract
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "src", "hooks", "use-translations.ts");
const out = join(root, "src", "i18n", "en.json");

const text = readFileSync(source, "utf8");
// The `en` map only; anything after it (the hook itself) must not be scanned.
const start = text.indexOf("export const en");
const end = text.indexOf("\n};", start);
if (start < 0 || end < 0) {
  console.error("Could not find the `en` map in use-translations.ts");
  process.exit(1);
}
const body = text.slice(start, end);

const messages = {};
for (const [, key, raw] of body.matchAll(/"([a-z0-9_.]+)":\s*\n?\s*"((?:[^"\\]|\\.)*)"/g)) {
  messages[key] = raw.replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
}

const sorted = Object.fromEntries(Object.keys(messages).sort().map((k) => [k, messages[k]]));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(sorted, null, 2)}\n`);
console.log(`wrote src/i18n/en.json (${Object.keys(sorted).length} keys)`);
