import DOMPurify from "isomorphic-dompurify";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ErrorState } from "@/components/ui/states";
import { enhanceCmsHtml } from "@/lib/cms-html";
import { formatDay } from "@/lib/format";
import { localeHref } from "@/lib/languages";
import { fetchLanguages, fetchPage, fetchTranslations } from "@/lib/server-data";

export const revalidate = 60;

/** The API sanitises body_html on save; this render-time allow-list is defence in depth. */
const SANITIZE = {
  ALLOWED_TAGS: [
    "a", "abbr", "b", "blockquote", "br", "code", "dd", "div", "dl", "dt", "em", "figcaption", "figure", "h1", "h2", "h3",
    "h4", "h5", "h6", "hr", "i", "img", "li", "ol", "p", "pre", "s", "small", "span", "strong", "sub", "sup", "table",
    "tbody", "td", "th", "thead", "tr", "u", "ul",
  ],
  ALLOWED_ATTR: ["href", "title", "alt", "src", "width", "height", "colspan", "rowspan", "lang", "dir", "id", "class"],
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|\/(?!\/))/i,
};

export async function generateMetadata({ params }: PageProps<"/[lang]/p/[slug]">): Promise<Metadata> {
  const { lang, slug } = await params;
  const [page, languages] = await Promise.all([fetchPage(slug, lang), fetchLanguages()]);
  if (!page.ok && page.status === 404) notFound();
  if (!page.ok) return { title: "Page" };
  const path = `/p/${slug}`;
  return {
    title: page.data.title,
    alternates: {
      canonical: localeHref(lang, path),
      languages: Object.fromEntries(languages.map((l) => [l.code, localeHref(l.code, path)])),
    },
  };
}

export default async function CmsPage({ params }: PageProps<"/[lang]/p/[slug]">) {
  const { lang, slug } = await params;
  const [page, messages] = await Promise.all([fetchPage(slug, lang), fetchTranslations(lang)]);
  const t = (key: string, fallback: string) => messages[key] || fallback;
  if (!page.ok) {
    if (page.status === 404) notFound();
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <ErrorState message={t("page.error", "This page could not be loaded right now.")} retryLabel={t("common.retry", "Try again")} />
      </div>
    );
  }
  const { html, toc } = enhanceCmsHtml(DOMPurify.sanitize(page.data.body_html, SANITIZE));
  const updated = formatDay(page.data.updated_at, lang);
  return (
    <article className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="font-display mb-2 text-3xl font-bold text-ink">{page.data.title}</h1>
      {updated ? (
        <p className="mb-6 text-sm text-muted">
          {t("page.updated", "Last updated")} <time dateTime={page.data.updated_at ?? undefined}>{updated}</time>
        </p>
      ) : (
        <div className="mb-6" />
      )}

      {/* Only for pages long enough to get lost in; a two-heading contents list is noise. */}
      {toc.length > 0 ? (
        <nav aria-label={t("page.contents", "On this page")} className="mb-8 rounded-card border border-line bg-surface-2/50 p-4 print:hidden">
          <h2 className="mb-2 text-sm font-semibold text-ink">{t("page.contents", "On this page")}</h2>
          <ol className="space-y-1 text-sm">
            {toc.map((entry) => (
              <li key={entry.id} className={entry.level === 3 ? "ps-4" : undefined}>
                <a href={`#${entry.id}`} className="text-ink-2 underline-offset-2 hover:text-accent hover:underline">
                  {entry.text}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      ) : null}

      <div className="prose-cms" dangerouslySetInnerHTML={{ __html: html }} />
    </article>
  );
}
