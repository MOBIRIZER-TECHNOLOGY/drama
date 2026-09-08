/**
 * Prepares sanitised CMS HTML for reading.
 *
 * Legal and help pages arrive from the admin as one unbroken run of markup. Three things were missing and all
 * three are the difference between a page someone can use and a wall of text:
 *
 * - headings had no ids, so nothing could link to "Refunds" — the section a support reply needs to point at;
 * - long pages had no way in other than scrolling;
 * - a pricing or comparison table overflowed the article and pushed the whole page sideways on a phone.
 *
 * The transform runs on the server against already-sanitised HTML, so it adds no client JavaScript.
 */

export type TocEntry = { id: string; text: string; level: 2 | 3 };

/** Strips tags and decodes the few entities the sanitiser leaves behind, for heading text and slugs. */
function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A URL-safe id. Keeps non-Latin letters rather than transliterating them: a Hindi page's anchors should be
 * Hindi, and browsers handle percent-encoded fragments fine.
 */
function slugify(text: string, taken: Set<string>): string {
  const base =
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "section";
  let id = base;
  let n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  taken.add(id);
  return id;
}

export function enhanceCmsHtml(html: string): { html: string; toc: TocEntry[] } {
  const toc: TocEntry[] = [];
  const taken = new Set<string>();

  let out = html.replace(/<h([23])([^>]*)>([\s\S]*?)<\/h\1>/gi, (match, levelRaw: string, attrs: string, inner: string) => {
    const text = plainText(inner);
    if (!text) return match;
    // An id the author set by hand wins: they may already have published links to it.
    const existing = /\sid\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    const id = existing ?? slugify(text, taken);
    if (existing) taken.add(existing);
    const level = levelRaw === "2" ? 2 : 3;
    toc.push({ id, text, level });
    const withId = existing ? attrs : `${attrs} id="${id}"`;
    return `<h${levelRaw}${withId}>${inner}</h${levelRaw}>`;
  });

  // Tables scroll inside their own box; without this one wide table makes the whole article scroll sideways.
  out = out.replace(/<table[\s\S]*?<\/table>/gi, (table) => `<div class="cms-scroll">${table}</div>`);

  // A table of contents for two headings is noise, not navigation.
  return { html: out, toc: toc.length >= 3 ? toc : [] };
}
