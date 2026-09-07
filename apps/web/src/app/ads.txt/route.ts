/**
 * `ads.txt` for programmatic demand. The content is deployment configuration, not API data:
 * `NEXT_PUBLIC_ADS_TXT` holds the lines (use `\n` for line breaks). Empty is allowed and serves an empty file.
 */
export const dynamic = "force-static";
export const revalidate = 3600;

export function GET(): Response {
  const body = (process.env.NEXT_PUBLIC_ADS_TXT ?? "").replace(/\\n/g, "\n").trim();
  return new Response(body ? `${body}\n` : "", {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
