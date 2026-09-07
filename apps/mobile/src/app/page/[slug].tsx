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
          source={{ html: wrap(page.data.body_html) }}
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

function wrap(body: string): string {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
  body{margin:0;padding:16px 20px 40px;background:${colors.ground};color:${colors.ink2};font:16px/1.6 -apple-system,Roboto,sans-serif}
  h1,h2,h3{color:${colors.ink}} a{color:${colors.accent}}
  </style></head><body>${body}</body></html>`;
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  web: { flex: 1, backgroundColor: colors.ground },
});
