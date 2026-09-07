/**
 * Extract every `t("key", "English fallback")` in the app into src/i18n/en.json.
 *
 * The English copy lives inline at each call site, which is the right ergonomics for writing screens but left
 * the API with nothing to seed: `services/api/scripts/seed_translations.py` reads this file and it did not
 * exist, so `ui_translations` shipped empty and the product was English-only in seven languages' clothing.
 *
 * Run: pnpm --filter web run i18n:extract
 * Then: cd services/api && uv run python scripts/seed_translations.py ../../apps/web/src/i18n/en.json
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src");
const out = join(src, "i18n", "en.json");

/** `t("some.key", "Fallback text")` — the second argument may contain escaped quotes. */
const CALL = /\bt\(\s*"([a-z0-9_.]+)"\s*,\s*"((?:[^"\\]|\\.)*)"/g;

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else if (/\.(tsx?|mts)$/.test(entry)) files.push(full);
  }
  return files;
}

const messages = {};
const conflicts = [];

for (const file of walk(src)) {
  const text = readFileSync(file, "utf8");
  for (const [, key, raw] of text.matchAll(CALL)) {
    const value = raw.replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
    if (key in messages && messages[key] !== value) {
      // The same key with two different English strings means one screen will silently rewrite the other's copy
      // once a translator edits it. Worth failing loudly rather than picking a winner.
      conflicts.push(`${key}\n  ${messages[key]}\n  ${value}`);
      continue;
    }
    messages[key] = value;
  }
}

if (conflicts.length) {
  console.error(`Conflicting fallbacks for ${conflicts.length} key(s):\n\n${conflicts.join("\n\n")}\n`);
  process.exit(1);
}

const sorted = Object.fromEntries(Object.keys(messages).sort().map((k) => [k, messages[k]]));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(sorted, null, 2)}\n`);
console.log(`wrote src/i18n/en.json (${Object.keys(sorted).length} keys)`);
