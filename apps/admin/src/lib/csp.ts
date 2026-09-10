/**
 * Content-Security-Policy for the console, built per request around a script nonce.
 *
 * It lived in `next.config.ts` with `script-src 'unsafe-inline'`, which is the one directive that matters for
 * an app whose session token is readable from JavaScript: with inline scripts allowed anywhere, a single
 * injected `<script>` reads localStorage and the session is gone. The nonce is minted in `proxy.ts`, put on
 * this header, and Next applies it to every script it emits (framework, chunks, its own inline bootstrap).
 * Anything inline without it is refused.
 *
 * Environment values are read here rather than in the proxy so the origin parsing has one home. They are
 * `NEXT_PUBLIC_*`, so they are inlined at build time and available to the edge runtime.
 */

const isProd = process.env.NODE_ENV === "production";
const apiOrigin = safeOrigin(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000");

/** Extra origins the browser talks to directly: presigned upload PUTs and public media (MinIO/S3/CDN). */
const uploadOrigins = (process.env.NEXT_PUBLIC_UPLOAD_ORIGINS ?? (isProd ? "" : "http://localhost:9000"))
  .split(/\s+/)
  .map(safeOrigin)
  .filter((o): o is string => Boolean(o));

export function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    // 'strict-dynamic' lets the nonced Next runtime load the chunks it decides it needs; 'self' is the fallback
    // for browsers that predate it. Dev tooling (React's server-stack reconstruction) still needs eval.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isProd ? "" : " 'unsafe-eval'"}`,
    `connect-src 'self' ${[apiOrigin, ...uploadOrigins].filter(Boolean).join(" ")}`.trim(),
    `img-src 'self' https: data: blob:${isProd ? "" : " http:"}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    // `'self'` is not optional here: `next/font` serves the console's own faces from this origin — from
    // `/__nextjs_font/` in development and `/_next/static/media/` in a build — so a policy naming only the
    // Google host blocks every font the app actually ships and silently falls back to system faces.
    "font-src 'self' data: https://fonts.gstatic.com",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

function safeOrigin(u: string): string | null {
  try {
    return new URL(u).origin;
  } catch {
    return null;
  }
}
