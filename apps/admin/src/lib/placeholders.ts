/**
 * Placeholder safety for translations.
 *
 * The app interpolates `{name}` tokens into strings at render time. A translator who drops `{count}`, renames
 * it, or introduces one the source does not have produces a string that renders the literal brace text to the
 * viewer — or, in the counted cases, a sentence missing its number. Nothing checked for it, and nothing could
 * have caught it before it shipped, because the value goes straight from the editor to the live table both
 * clients read.
 *
 * The rule is deliberately narrow: the set of placeholder names must match. Order and count of occurrences may
 * differ, because word order legitimately changes between languages and a token can reasonably repeat.
 */

const TOKEN = /\{([a-z0-9_]+)\}/gi;

export function placeholders(text: string): Set<string> {
  const found = new Set<string>();
  for (const [, name] of text.matchAll(TOKEN)) found.add(name.toLowerCase());
  return found;
}

export type PlaceholderProblem = { missing: string[]; unexpected: string[] };

/**
 * Compare a translation against its source string.
 *
 * Returns null when the translation is safe — including when it is empty, which means "not translated yet"
 * rather than "broken".
 */
export function checkPlaceholders(source: string, translation: string): PlaceholderProblem | null {
  if (!translation.trim()) return null;
  const want = placeholders(source);
  const got = placeholders(translation);
  const missing = [...want].filter((k) => !got.has(k));
  const unexpected = [...got].filter((k) => !want.has(k));
  return missing.length || unexpected.length ? { missing, unexpected } : null;
}

export function describeProblem(problem: PlaceholderProblem): string {
  const parts: string[] = [];
  if (problem.missing.length) parts.push(`missing ${problem.missing.map((k) => `{${k}}`).join(", ")}`);
  if (problem.unexpected.length) parts.push(`unknown ${problem.unexpected.map((k) => `{${k}}`).join(", ")}`);
  return parts.join("; ");
}

/**
 * Length warning against the source.
 *
 * A 12-character English label becoming a 40-character Hindi one overflows the button it sits in, and the first
 * anyone hears of it is a screenshot. Only flagged well past the point where it is plausibly just a longer word.
 */
export function tooLong(source: string, translation: string): boolean {
  const s = source.trim().length;
  const t = translation.trim().length;
  return s > 0 && t > Math.max(24, s * 2.2);
}
