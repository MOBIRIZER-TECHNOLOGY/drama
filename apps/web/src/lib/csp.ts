/**
 * Content-Security-Policy, built per response around a nonce (see src/proxy.ts).
 *
 * Third parties: Razorpay Checkout, Cloudflare Turnstile, Firebase Auth (Google popup), and the video hosts
 * that may appear in `embed_html`. Media (HLS, VTT, covers) comes from NEXT_PUBLIC_MEDIA_ORIGINS.
 *
 * script-src carries no 'unsafe-inline'. Next.js reads the nonce back out of the Content-Security-Policy
 * *request* header the proxy sets and stamps it on every inline script it emits itself (the RSC payload,
 * hydration, the dev overlay); a script this app renders takes it from `headers().get("x-nonce")`. The
 * short-lived access token lives in localStorage (see token-store.ts) because every API call has to attach
 * it as a bearer header, so an injected inline script is the one thing this policy most needs to shut out,
 * and 'unsafe-inline' allowed exactly that. The 30-day refresh token is out of script's reach altogether: the
 * auth BFF (src/app/api/auth) keeps it in an httpOnly cookie, and connect-src 'self' is what lets the page
 * call those routes.
 *
 * style-src keeps 'unsafe-inline': next/font injects its @font-face rules as an inline <style>, and React
 * `style={}` attributes are governed by style-src as well. Neither can carry a nonce.
 *
 * Runs in the proxy, so only NEXT_PUBLIC_* values and NODE_ENV are available here.
 */

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const IS_DEV = process.env.NODE_ENV === "development";

/** Media/CDN origins (HLS, covers, subtitles, avatars). Comma-separated, e.g. https://cdn.katha.app,http://localhost:9000 */
const MEDIA_ORIGINS = (process.env.NEXT_PUBLIC_MEDIA_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .join(" ");

export function contentSecurityPolicy(nonce: string): string {
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self' https://checkout.stripe.com",
    `script-src 'self' 'nonce-${nonce}'${IS_DEV ? " 'unsafe-eval'" : ""} https://checkout.razorpay.com https://challenges.cloudflare.com https://apis.google.com https://*.firebaseapp.com https://*.googleapis.com`,
    `connect-src 'self' ${API_URL} ${MEDIA_ORIGINS} https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://checkout.razorpay.com https://api.razorpay.com https://lumberjack.razorpay.com https://challenges.cloudflare.com${IS_DEV ? " ws: wss:" : ""}`,
    // `https:` covers the media host in production, which is why the missing origins here went unnoticed:
    // the moment media is served over http — dev, a LAN preview, a staging box, a production build behind a
    // proxy that has not terminated TLS yet — every cover and thumbnail is blocked, and the page renders with
    // holes and a console full of CSP violations rather than anything that points at the cause.
    `img-src 'self' data: blob: https: ${MEDIA_ORIGINS}`,
    `media-src 'self' blob: ${MEDIA_ORIGINS}`,
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

/** 128 random bits, base64: what the CSP spec asks of a nonce. Web Crypto is available in both proxy runtimes. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
