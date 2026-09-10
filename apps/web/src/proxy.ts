import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy, newNonce } from "@/lib/csp";
import { DEFAULT_LANG, SUPPORTED_LANGS } from "@/lib/languages";

/**
 * Two jobs, both per request.
 *
 * Language routing: `/series/x` renders as `/en/series/x` (URL unchanged); `/hi/series/x` passes through;
 * `/en/series/x` redirects (308) to the canonical `/series/x`. The prefixes it knows are the build-time list
 * (next.config.ts → NEXT_PUBLIC_LANGS), deliberately: this runs in front of every page on the edge or node
 * runtime, and even a memoised call to the API here would put a network round trip and its timeout on the
 * hot path of every cold instance. The build now refuses to run without an explicit or resolvable list, so
 * what is routed here is never a silent en/hi guess; the layout and the sitemap, which already talk to the
 * API, take the live list. A language activated after the build still needs a web restart for its prefix.
 *
 * CSP nonce: one per response. It goes on the response so the browser enforces it, and on the *request* —
 * as `x-nonce` for this app's own inline scripts and as `Content-Security-Policy` for Next, which reads the
 * nonce back out of that header and stamps its own inline scripts with it. Every HTML response is therefore
 * rendered per request (see the root layout); a cached page would carry a nonce that no longer matches.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const [, first = "", ...rest] = pathname.split("/");
  const internalLocaleRewrite = request.headers.get("x-katha-locale-rewrite") === "1";
  if (first === DEFAULT_LANG && !internalLocaleRewrite) {
    const url = request.nextUrl.clone();
    url.pathname = `/${rest.join("/")}`;
    return NextResponse.redirect(url, 308);
  }

  const nonce = newNonce();
  const csp = contentSecurityPolicy(nonce);
  const headers = new Headers(request.headers);
  headers.delete("x-katha-locale-rewrite");
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);

  let response: NextResponse;
  if (SUPPORTED_LANGS.includes(first)) {
    response = NextResponse.next({ request: { headers } });
  } else {
    const url = request.nextUrl.clone();
    url.pathname = pathname === "/" ? `/${DEFAULT_LANG}` : `/${DEFAULT_LANG}${pathname}`;
    headers.set("x-katha-locale-rewrite", "1");
    response = NextResponse.rewrite(url, { request: { headers } });
  }
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // Skip Next internals, the API proxy prefix and static assets by real extension (so `/series/my.drama` still routes).
  matcher: [
    "/((?!_next/|api/|.*\\.(?:ico|png|jpe?g|gif|svg|webp|avif|css|js|map|txt|xml|json|woff2?|ttf|otf|webmanifest|mp4|m3u8|ts|vtt)$).*)",
  ],
};
