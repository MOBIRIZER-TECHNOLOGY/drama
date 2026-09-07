import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LANG, SUPPORTED_LANGS } from "@/lib/languages";

/**
 * `/series/x` renders as `/en/series/x` (URL unchanged); `/hi/series/x` passes through;
 * `/en/series/x` redirects (308) to the canonical `/series/x`.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const [, first = "", ...rest] = pathname.split("/");
  if (first === DEFAULT_LANG) {
    const url = request.nextUrl.clone();
    url.pathname = `/${rest.join("/")}`;
    return NextResponse.redirect(url, 308);
  }
  if (SUPPORTED_LANGS.includes(first)) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = pathname === "/" ? `/${DEFAULT_LANG}` : `/${DEFAULT_LANG}${pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  // Skip Next internals, the API proxy prefix and static assets by real extension (so `/series/my.drama` still routes).
  matcher: [
    "/((?!_next/|api/|.*\\.(?:ico|png|jpe?g|gif|svg|webp|avif|css|js|map|txt|xml|json|woff2?|ttf|otf|webmanifest|mp4|m3u8|ts|vtt)$).*)",
  ],
};
