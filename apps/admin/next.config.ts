import type { NextConfig } from "next";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const apiOrigin = safeOrigin(apiUrl);
const isProd = process.env.NODE_ENV === "production";

/** Extra origins the browser talks to directly: presigned upload PUTs and public media (MinIO/S3/CDN). */
const uploadOrigins = (process.env.NEXT_PUBLIC_UPLOAD_ORIGINS ?? (isProd ? "" : "http://localhost:9000"))
  .split(/\s+/)
  .map(safeOrigin)
  .filter((o): o is string => Boolean(o));

const csp = [
  "default-src 'self'",
  // Next.js hydration relies on inline scripts; dev tooling needs eval. Nonce-based CSP is a later phase.
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
  `connect-src 'self' ${[apiOrigin, ...uploadOrigins].filter(Boolean).join(" ")}`.trim(),
  `img-src 'self' https: data: blob:${isProd ? "" : " http:"}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

function safeOrigin(u: string): string | null {
  try {
    return new URL(u).origin;
  } catch {
    return null;
  }
}

export default nextConfig;
