/**
 * IndexNow key file. Search engines fetch `https://site/<key>.txt` and expect the key as the body;
 * `next.config.ts` rewrites that path here when `NEXT_PUBLIC_INDEXNOW_KEY` is set. Without a key this
 * route 404s (and no rewrite exists), so nothing is exposed.
 */
export const dynamic = "force-static";

export function GET(): Response {
  const key = (process.env.NEXT_PUBLIC_INDEXNOW_KEY ?? "").trim();
  if (!key) return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  return new Response(key, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=86400" },
  });
}
