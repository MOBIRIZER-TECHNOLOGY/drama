/**
 * Turning a stored media key into something an `<img>` can load.
 *
 * The catalogue stores keys (`library/ashes-of-lucknow/cover.jpg`), not URLs, so that the CDN can move
 * without rewriting every row. The public API resolves them against `cdn_base_url` before it answers; the
 * admin API deliberately does not, because the console edits these fields and has to send the key back
 * unchanged — resolving them on the way out would mean saving an absolute URL on the way in, undoing the
 * very thing keys exist for.
 *
 * So the console resolves them itself, at render time only. This lives here rather than inside the upload
 * component because the drama list needs it too: it rendered `src={cover_url}` directly, the browser
 * resolved the key against the console's own origin, and every thumbnail in the catalogue 404'd — visible
 * to anyone who opened the page, and invisible to anything that only checked the page had loaded.
 */
const MEDIA_BASE = (process.env.NEXT_PUBLIC_MEDIA_BASE ?? "").replace(/\/$/, "");

/** Absolute URL for a stored key. Values that are already absolute are returned untouched. */
export function mediaSrc(value: string | null | undefined): string | null {
  if (!value) return null;
  // A pasted value may already be a URL, and data: URIs come from a local preview.
  if (/^(https?:)?\/\//.test(value) || value.startsWith("data:")) return value;
  if (!MEDIA_BASE) return null;
  return `${MEDIA_BASE}/${value.replace(/^\//, "")}`;
}
