/**
 * Only a same-site path is honoured as a `?next=` destination.
 *
 * The value arrives in the URL, so it is whatever the sender wrote. `startsWith("/")` plus a `//` check let
 * `/\evil.com` through: browsers treat a backslash as a slash in http URLs, so it resolves to `//evil.com`
 * and the "return to where you were" link became an open redirect. Parsing the value against a fixed origin
 * and checking the origin survived is the only test that covers every spelling of that trick. The origin is
 * a placeholder rather than `window.location.origin` so the answer is the same on the server and the client
 * and hydration cannot disagree with itself.
 */
const PLACEHOLDER_ORIGIN = "http://katha.invalid";

export function safeNext(next: string | null | undefined): string | null {
  if (!next) return null;
  try {
    const url = new URL(next, PLACEHOLDER_ORIGIN);
    if (url.origin !== PLACEHOLDER_ORIGIN) return null;
    if (!url.pathname.startsWith("/") || url.pathname.startsWith("//")) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
