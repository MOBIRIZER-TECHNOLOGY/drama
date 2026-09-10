import { colors, spacing } from "@katha/tokens";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import type { ShouldStartLoadRequest } from "react-native-webview/lib/WebViewTypes";
import { Icon } from "@/components/icons";
import { Button, EmptyState, Loading, Screen, Text } from "@/components/ui";
import { useT } from "@/hooks/use-translations";
import { takeRazorpayCheckout, type CheckoutOutcome } from "@/lib/checkout-session";

/**
 * Razorpay checkout, hosted in a WebView.
 *
 * Razorpay has no hosted page to redirect to the way Stripe does: it hands back an order and expects its own
 * checkout script to open against it. The reference does the same thing — an in-app WebView dialog — and this
 * is the only way to reach it without adding the native SDK, which Expo Go cannot load.
 *
 * What the page needs (key, order, amount) arrives through the in-memory store the wallet fills right before
 * pushing this route, never through route params: every route here is deep-linkable, and a link must not be
 * able to put its own merchant key and amount in front of a viewer under our name.
 *
 * Nothing here decides whether the purchase succeeded. The script's callbacks only close this screen; the
 * wallet then polls `GET /v1/purchases/{id}` and the coins are granted by the verified webhook, exactly as
 * with Stripe. A page inside a WebView is not evidence of payment.
 */

/** Hosts the checkout may navigate to inside the WebView. Anything else is handled by `shouldStartLoad`. */
const ORIGIN_WHITELIST = ["https://checkout.razorpay.com", "https://api.razorpay.com", "https://*.razorpay.com"];

const RAZORPAY_HOST = /^https:\/\/([a-z0-9-]+\.)*razorpay\.com(\/|\?|#|$)/i;
/** Bank and UPI apps: handed to the OS, which knows how to open them; the WebView does not. */
const APP_SCHEME = /^(upi|intent|tez|phonepe|paytm|gpay|bhim):/i;

export default function RazorpayCheckoutScreen() {
  const t = useT();
  const router = useRouter();
  // Claimed once, on mount. A second mount (or a deep link) finds nothing and shows the fallback below.
  const [session] = useState(() => takeRazorpayCheckout());
  const [ready, setReady] = useState(false);
  // A dismissal must close this screen exactly once: the script can fire both `modal.ondismiss` and an error.
  const closed = useRef(false);

  const close = useCallback(
    (outcome: CheckoutOutcome) => {
      if (closed.current) return;
      closed.current = true;
      session?.report(outcome);
      if (router.canGoBack()) router.back();
      else router.replace("/wallet");
    },
    [router, session],
  );

  // Leaving any other way (hardware back, swipe) is a cancellation as far as the wallet is concerned.
  useEffect(
    () => () => {
      if (!closed.current) session?.report("cancelled");
    },
    [session],
  );

  const html = useMemo(() => {
    if (!session) return "";
    const { checkout } = session;
    const options = JSON.stringify({
      key: checkout.keyId,
      order_id: checkout.orderId,
      amount: checkout.amountMinor,
      currency: checkout.currency,
      name: checkout.name,
      prefill: checkout.email ? { email: checkout.email } : undefined,
      theme: { color: colors.accent },
      // `<` never appears literally inside the script block, so no value can close it and start markup.
    }).replace(/</g, "\\u003c");
    // Built as a document rather than a redirect because there is no URL to redirect to. `baseUrl` gives the
    // page an https origin, which Razorpay's script requires and `about:blank` would not satisfy.
    return `<!doctype html>
<html>
  <head><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
  <body style="margin:0;background:${colors.ground}">
    <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
    <script>
      var post = function (type) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: type }));
      };
      var options = ${options};
      options.handler = function () { post("done"); };
      options.modal = { ondismiss: function () { post("cancelled"); } };
      try {
        var rzp = new Razorpay(options);
        rzp.on("payment.failed", function () { post("cancelled"); });
        rzp.open();
      } catch (e) {
        post("cancelled");
      }
    </script>
  </body>
</html>`;
  }, [session]);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const data = JSON.parse(event.nativeEvent.data) as { type?: string };
        close(data.type === "done" ? "done" : "cancelled");
      } catch {
        close("cancelled");
      }
    },
    [close],
  );

  /**
   * Razorpay's own hosts load in place. A bank's 3-D Secure page is https and also loads in place. UPI and
   * app intents leave for the OS, which is the only thing that can open them. Everything else is refused.
   */
  const shouldStartLoad = useCallback((request: ShouldStartLoadRequest) => {
    const url = request.url;
    if (url === "about:blank" || RAZORPAY_HOST.test(url)) return true;
    if (APP_SCHEME.test(url)) {
      Linking.openURL(url).catch(() => {});
      return false;
    }
    return url.startsWith("https://");
  }, []);

  if (!session) {
    return (
      <Screen edges={["top", "left", "right", "bottom"]}>
        <View style={styles.header}>
          <Pressable onPress={() => close("cancelled")} accessibilityRole="button" accessibilityLabel={t("common.close")} hitSlop={10}>
            <Icon name="close" size={26} />
          </Pressable>
          <Text variant="title">{t("wallet.secure_checkout")}</Text>
          <View style={{ width: 26 }} />
        </View>
        <EmptyState title={t("wallet.checkout_missing")} action={<Button title={t("common.back")} onPress={() => close("cancelled")} />} />
      </Screen>
    );
  }

  return (
    <Screen edges={["top", "left", "right", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => close("cancelled")} accessibilityRole="button" accessibilityLabel={t("common.close")} hitSlop={10}>
          <Icon name="close" size={26} />
        </Pressable>
        <Text variant="title">{t("wallet.secure_checkout")}</Text>
        <View style={{ width: 26 }} />
      </View>
      <View style={styles.body}>
        <WebView
          originWhitelist={ORIGIN_WHITELIST}
          onShouldStartLoadWithRequest={shouldStartLoad}
          source={{ html, baseUrl: "https://checkout.razorpay.com" }}
          onMessage={onMessage}
          onLoadEnd={() => setReady(true)}
          onError={() => close("cancelled")}
          javaScriptEnabled
          domStorageEnabled
          style={styles.web}
        />
        {ready ? null : (
          <View style={styles.loading}>
            <Loading label={t("wallet.opening_checkout")} />
          </View>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  body: { flex: 1 },
  web: { flex: 1, backgroundColor: colors.ground },
  loading: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", backgroundColor: colors.ground },
});
