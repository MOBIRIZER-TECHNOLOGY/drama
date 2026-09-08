import { ImageResponse } from "next/og";
import { fetchSeries } from "@/lib/server-data";

export const alt = "Katha";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Share card for a series.
 *
 * The page previously handed WhatsApp and Twitter the 9:16 portrait cover as a `summary_large_image`, which
 * centre-crops to an unreadable band — and WhatsApp is where this audience shares. This composes the cover as a
 * poster beside the title, the episode count and the free-episode promise, on the brand ground, at the 1.91:1
 * the platforms actually render.
 *
 * Deliberately no webfont fetch: a share card is generated on the hot path of every crawl, and a missing font
 * request would either block it or silently fall back. The system stack renders predictably at this size.
 */
export default async function Image({ params }: { params: Promise<{ lang: string; slug: string }> }) {
  const { lang, slug } = await params;
  const result = await fetchSeries(slug, lang);
  const series = result.ok ? result.data : null;

  const title = series?.title ?? "Katha";
  const episodes = series?.episode_count ?? 0;
  const free = series?.free_episodes ?? 0;
  const cover = series?.cover_url ?? null;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#0A0A0A",
          color: "#F4ECEE",
          padding: 64,
          gap: 56,
          alignItems: "center",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        }}
      >
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover}
            alt=""
            width={288}
            height={502}
            style={{ width: 288, height: 502, objectFit: "cover", borderRadius: 20, flexShrink: 0 }}
          />
        ) : null}
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28 }}>
            <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: -0.5 }}>Katha</div>
            <div style={{ width: 8, height: 8, borderRadius: 8, background: "#F42452" }} />
            <div style={{ fontSize: 22, color: "#A29398" }}>Short dramas</div>
          </div>
          <div
            style={{
              fontSize: title.length > 40 ? 62 : 78,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: -1.5,
              display: "block",
              // Two lines maximum; a long title truncates rather than pushing the metadata off the card.
              overflow: "hidden",
              maxHeight: title.length > 40 ? 200 : 250,
            }}
          >
            {title}
          </div>
          <div style={{ display: "flex", gap: 16, marginTop: 36, alignItems: "center" }}>
            {episodes > 0 ? (
              <div
                style={{
                  fontSize: 28,
                  padding: "10px 22px",
                  borderRadius: 999,
                  background: "#141414",
                  border: "1px solid #332A2E",
                }}
              >
                {episodes} episodes
              </div>
            ) : null}
            {free > 0 ? (
              <div
                style={{
                  fontSize: 28,
                  padding: "10px 22px",
                  borderRadius: 999,
                  background: "#F42452",
                  color: "#2A0F16",
                  fontWeight: 600,
                }}
              >
                First {free} free
              </div>
            ) : null}
          </div>
        </div>
      </div>
    ),
    size,
  );
}
