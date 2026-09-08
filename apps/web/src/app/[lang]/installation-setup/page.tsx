import { permanentRedirect } from "next/navigation";
import { localeHref } from "@/lib/languages";

/**
 * URL parity with the reference, which hard-codes a route for one CMS page.
 *
 * There is nothing to build here. The reference's `installation-setup` page reads a `pages` document by that
 * slug and renders its HTML, which is exactly what `/[lang]/p/[slug]` already does for every CMS page. A
 * second renderer for one slug would be a second place to keep the sanitiser, the metadata and the language
 * fallback correct, so this only forwards.
 *
 * Permanent rather than temporary: the canonical location is the CMS route, and search engines should be told
 * so rather than indexing two URLs for one document.
 */
export default async function InstallationSetupPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  permanentRedirect(localeHref(lang, "/p/installation-setup"));
}
