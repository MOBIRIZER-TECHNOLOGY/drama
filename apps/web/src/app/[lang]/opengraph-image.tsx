import { ImageResponse } from "next/og";
import { fetchTranslations } from "@/lib/server-data";

export const alt = "Katha — short dramas";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Default share card for every page that does not compose its own. Without one, a link to katha.app pasted into
 * WhatsApp renders as a bare URL, which is the first impression most of this audience gets.
 */
export default async function Image({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const messages = await fetchTranslations(lang);
  const tagline = messages["meta.description"] || "Binge bite-sized dramas in your language.";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          background: "#0A0A0A",
          color: "#F4ECEE",
          padding: 96,
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        }}
      >
        <div style={{ display: "flex", fontSize: 116, fontWeight: 700, letterSpacing: -3 }}>
          Katha<span style={{ color: "#F42452" }}>.</span>
        </div>
        <div style={{ display: "flex", fontSize: 40, color: "#A29398", marginTop: 20, maxWidth: 900 }}>{tagline}</div>
        <div style={{ display: "flex", gap: 16, marginTop: 56 }}>
          {["Hindi", "Tamil", "Telugu", "Bengali", "English"].map((l) => (
            <div
              key={l}
              style={{
                fontSize: 26,
                padding: "10px 22px",
                borderRadius: 999,
                background: "#141414",
                border: "1px solid #332A2E",
              }}
            >
              {l}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
