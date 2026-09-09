import type { NextConfig } from "next";

const FALLBACK_LANGS = ["en", "hi"];
const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const IS_DEV = process.env.NODE_ENV === "development";

/** Media/CDN origins (HLS, covers, subtitles, avatars). Comma-separated, e.g. https://cdn.katha.app,http://localhost:9000 */
const MEDIA_ORIGINS = (process.env.NEXT_PUBLIC_MEDIA_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/** IndexNow key (letters/digits/dashes only); when set, `/{key}.txt` serves it. */
const INDEXNOW_KEY = (process.env.NEXT_PUBLIC_INDEXNOW_KEY ?? "").trim().match(/^[A-Za-z0-9-]{8,128}$/)?.[0] ?? "";

/** Avatar hosts from the sign-in providers. */
const PROVIDER_IMAGE_HOSTS = ["lh3.googleusercontent.com", "graph.facebook.com"];

/**
 * Supported language prefixes are resolved once at build/start time from the API so the proxy can
 * route `/hi/...` without a network call per request. Falls back to en/hi when the API is unreachable.
 */
async function resolveLanguages(): Promise<string[]> {
  try {
    const res = await fetch(`${API_URL}/v1/languages`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return FALLBACK_LANGS;
    const rows = (await res.json()) as { code?: string }[];
    const codes = rows.map((r) => r.code ?? "").filter((c) => /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(c));
    if (!codes.includes("en")) codes.unshift("en");
    return codes.length ? codes : FALLBACK_LANGS;
  } catch {
    return FALLBACK_LANGS;
  }
}

function originToPattern(origin: string): { protocol: "http" | "https"; hostname: string; port?: string } | null {
  try {
    const u = new URL(origin);
    return { protocol: u.protocol === "http:" ? "http" : "https", hostname: u.hostname, port: u.port || undefined };
  } catch {
    return null;
  }
}

/**
 * Content-Security-Policy. Third parties: Razorpay Checkout, Cloudflare Turnstile, Firebase Auth (Google popup),
 * and the video hosts that may appear in `embed_html`. Media (HLS, VTT, covers) comes from NEXT_PUBLIC_MEDIA_ORIGINS.
 * TODO: move script-src to a per-request nonce once the app has a place to thread it (Next 16 needs a proxy that sets
 * the nonce header and a matching <Script nonce>); 'unsafe-inline' is accepted for now.
 */
function contentSecurityPolicy(): string {
  const media = MEDIA_ORIGINS.join(" ");
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self' https://checkout.stripe.com",
    `script-src 'self' 'unsafe-inline'${IS_DEV ? " 'unsafe-eval'" : ""} https://checkout.razorpay.com https://challenges.cloudflare.com https://apis.google.com https://*.firebaseapp.com https://*.googleapis.com`,
    `connect-src 'self' ${API_URL} ${media} https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://checkout.razorpay.com https://api.razorpay.com https://lumberjack.razorpay.com https://challenges.cloudflare.com${IS_DEV ? " ws: wss:" : ""}`,
    // `https:` covers the media host in production, which is why the missing origins here went unnoticed:
    // the moment media is served over http — dev, a LAN preview, a staging box, a production build behind a
    // proxy that has not terminated TLS yet — every cover and thumbnail is blocked, and the page renders with
    // holes and a console full of CSP violations rather than anything that points at the cause.
    `img-src 'self' data: blob: https: ${media}`,
    `media-src 'self' blob: ${media}`,
    "worker-src 'self' blob:",
    "frame-src https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com https://www.dailymotion.com https://geo.dailymotion.com https://checkout.razorpay.com https://api.razorpay.com https://challenges.cloudflare.com https://*.firebaseapp.com",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
  ];
  // upgrade-insecure-requests rewrites every http:// subresource to https://, which silently strips the
  // stylesheet and media from any deployment actually served over http (dev, LAN preview, a staging box or a
  // production build fronted by a proxy that has not terminated TLS yet). Emit it only when the site itself
  // is https, where it is free protection rather than a self-inflicted outage.
  if (SITE_URL.startsWith("https://")) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

export default async function config(): Promise<NextConfig> {
  const langs = await resolveLanguages();
  // Comma-separated hosts allowed to load dev assets, e.g. a phone on the LAN: NEXT_DEV_ALLOWED_ORIGINS=192.168.1.20
  const devOrigins = (process.env.NEXT_DEV_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const remotePatterns = [
    ...MEDIA_ORIGINS.map(originToPattern).filter((p): p is NonNullable<typeof p> => p !== null),
    ...PROVIDER_IMAGE_HOSTS.map((hostname) => ({ protocol: "https" as const, hostname })),
  ];
  return {
    env: { NEXT_PUBLIC_LANGS: langs.join(",") },
    ...(devOrigins.length ? { allowedDevOrigins: devOrigins } : {}),
    images: {
      remotePatterns,
      // Development only. Media is served from a machine on the LAN (the emulator and the browser have to
      // reach one hostname between them), and Next blocks private addresses by default to stop the image
      // optimiser being used to probe an internal network. That protection matters in production, where this
      // stays off; locally the "internal network" is this laptop.
      dangerouslyAllowLocalIP: process.env.NODE_ENV === "development",
    },
    // IndexNow verification file: /<key>.txt must return the key. The path is dynamic, and the app root already
    // owns the `[lang]` segment, so it is rewritten onto a fixed route handler instead of a second dynamic segment.
    async rewrites() {
      return INDEXNOW_KEY ? [{ source: `/${INDEXNOW_KEY}.txt`, destination: "/api/indexnow" }] : [];
    },
    async headers() {
      return [
        {
          source: "/(.*)",
          headers: [
            { key: "Content-Security-Policy", value: contentSecurityPolicy() },
            { key: "X-Content-Type-Options", value: "nosniff" },
            { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
            { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
            { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
            { key: "X-Frame-Options", value: "DENY" },
          ],
        },
      ];
    },
  };
}
