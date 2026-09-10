import { headers } from "next/headers";

/**
 * Structured data. Rendered from server components only; the payload is built from API data, and
 * `<` is escaped so a title can never close the script tag.
 *
 * Carries the per-response CSP nonce (set by src/proxy.ts). A `ld+json` block is data the browser never
 * executes, so script-src does not block it today; the nonce is here so that this stays true if the type or
 * the policy ever changes, and so every inline <script> the app renders is handled the same way.
 */
export async function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return <script type="application/ld+json" nonce={nonce} dangerouslySetInnerHTML={{ __html: json }} />;
}
