import { colors, spacing } from "@katha/tokens";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { WebView, type WebViewNavigation } from "react-native-webview";
import { Icon } from "@/components/icons";
import { ErrorState, Loading, Screen, Text } from "@/components/ui";
import { useQuery } from "@/hooks/use-query";
import { useT } from "@/hooks/use-translations";
import { api } from "@/lib/api";
import { unwrap } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { useConfig } from "@/providers/config";

/** CMS page (privacy, terms, …) used when config.mobile has no external URL for it. */
export default function CmsPageScreen() {
  const t = useT();
  const router = useRouter();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { lang } = useConfig();
  const page = useQuery(async () => unwrap(await api.GET("/v1/pages/{slug}", { params: { path: { slug }, query: { lang } } })), [slug, lang]);

  // The WebView only renders the CMS HTML; any link leaves through the system browser sheet.
  const onShouldStartLoad = useCallback((req: WebViewNavigation) => {
    if (req.url === "about:blank" || req.url.startsWith("about:srcdoc")) return true;
    if (/^https?:\/\//i.test(req.url)) {
      WebBrowser.openBrowserAsync(req.url, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET }).catch(() => {});
    }
    return false;
  }, []);

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/me"))} accessibilityRole="button" accessibilityLabel="Back" hitSlop={10}>
          <Icon name="back" size={30} />
        </Pressable>
        <Text variant="title" numberOfLines={1} style={{ flex: 1 }}>
          {page.data?.title ?? ""}
        </Text>
      </View>
      {page.loading ? (
        <Loading />
      ) : page.error || !page.data ? (
        <ErrorState message={page.error ?? "Page not found"} onRetry={() => page.refetch({ silent: false })} retryLabel={t("common.retry")} />
      ) : (
        <WebView
          originWhitelist={["about:blank"]}
          source={{
            html: wrap(page.data.body_html, page.data.updated_at, t("page.updated"), t("page.contents")),
          }}
          onShouldStartLoadWithRequest={onShouldStartLoad}
          style={styles.web}
          setSupportMultipleWindows={false}
          javaScriptEnabled={false}
          javaScriptCanOpenWindowsAutomatically={false}
          allowFileAccess={false}
          allowFileAccessFromFileURLs={false}
          allowUniversalAccessFromFileURLs={false}
        />
      )}
    </Screen>
  );
}

/**
 * Wraps the CMS body for the WebView.
 *
 * Three things the raw body did not survive on a phone: a wide table pushed the whole document sideways, a
 * policy carried no date so a reader could not tell a current one from a stale copy, and a long refund policy
 * was a single scroll with no way in — the website's version of the same page has had a table of contents
 * since this morning and the phone did not.
 *
 * Anchors work inside a WebView with no JavaScript, which is why the contents list is plain markup.
 */
function wrap(
  body: string,
  updatedAt: string | null | undefined,
  updatedLabel: string,
  contentsLabel: string,
): string {
  const updated = updatedAt ? formatDate(updatedAt) : "";
  const stamp = updated ? `<p class="updated">${escapeHtml(updatedLabel)} ${escapeHtml(updated)}</p>` : "";
  const { html, toc } = withAnchors(body);
  // Two headings are a document, not something to navigate.
  const contents =
    toc.length >= 3
      ? `<nav class="toc"><p class="toc-title">${escapeHtml(contentsLabel)}</p><ol>${toc
          .map((h) => `<li class="lvl${h.level}"><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`)
          .join("")}</ol></nav>`
      : "";
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
  body{margin:0;padding:16px 20px 40px;background:${colors.ground};color:${colors.ink2};font:16px/1.6 -apple-system,Roboto,sans-serif}
  h1,h2,h3{color:${colors.ink}} a{color:${colors.accent}}
  h2,h3{scroll-margin-top:12px}
  .updated{margin:0 0 20px;font-size:13px;color:${colors.muted}}
  .toc{margin:0 0 24px;padding:12px 14px;border:1px solid ${colors.line};border-radius:12px;background:${colors.surface}}
  .toc-title{margin:0 0 8px;font-size:13px;font-weight:600;color:${colors.ink}}
  .toc ol{margin:0;padding-left:18px;font-size:14px}
  .toc li{margin:2px 0}
  .toc li.lvl3{margin-left:12px;list-style:circle}
  img{max-width:100%;height:auto}
  table{border-collapse:collapse;min-width:100%}
  td,th{border:1px solid ${colors.line};padding:6px 8px;text-align:start}
  .scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;margin-bottom:16px}
  </style></head><body>${stamp}${contents}${wrapTables(html)}</body></html>`;
}

/** Each table scrolls in its own box rather than widening the document. */
function wrapTables(body: string): string {
  return body.replace(/<table[\s\S]*?<\/table>/gi, (table) => `<div class="scroll">${table}</div>`);
}

/**
 * Give every h2/h3 an id and collect them.
 *
 * Ids keep non-Latin letters rather than transliterating: a Hindi policy's anchors should be Hindi, and a
 * WebView handles percent-encoded fragments fine.
 */
function withAnchors(body: string): { html: string; toc: { id: string; text: string; level: number }[] } {
  const toc: { id: string; text: string; level: number }[] = [];
  const taken = new Set<string>();
  const html = body.replace(/<h([23])([^>]*)>([\s\S]*?)<\/h\1>/gi, (match, level: string, attrs: string, inner: string) => {
    const text = inner
      .replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) return match;
    const existing = /\sid\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    let id = existing ?? text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60);
    if (!id) id = "section";
    let unique = id;
    let n = 2;
    while (taken.has(unique)) unique = `${id}-${n++}`;
    taken.add(unique);
    toc.push({ id: unique, text, level: Number(level) });
    return `<h${level}${existing ? attrs : `${attrs} id="${unique}"`}>${inner}</h${level}>`;
  });
  return { html, toc };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  web: { flex: 1, backgroundColor: colors.ground },
});
