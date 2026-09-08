import { colors, spacing } from "@katha/tokens";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { Icon } from "@/components/icons";
import { Loading, Screen, Text } from "@/components/ui";
import { useT } from "@/hooks/use-translations";

/**
 * Razorpay checkout, hosted in a WebView.
 *
 * Razorpay has no hosted page to redirect to the way Stripe does: it hands back an order and expects its own
 * checkout script to open against it. The reference does the same thing — an in-app WebView dialog — and this
 * is the only way to reach it without adding the native SDK, which Expo Go cannot load.
 *
 * Nothing here decides whether the purchase succeeded. The script's callbacks only close this screen; the
 * wallet then polls `GET /v1/purchases/{id}` and the coins are granted by the verified webhook, exactly as
 * with Stripe. A page inside a WebView is not evidence of payment.
 */
export default function RazorpayCheckoutScreen() {
  const t = useT();
  const router = useRouter();
  const { order_id, key_id, amount_minor, currency, name, email } = useLocalSearchParams<{
    order_id: string;
    key_id: string;
    amount_minor: string;
    currency: string;
    name?: string;
    email?: string;
  }>();
  const [ready, setReady] = useState(false);
  // A dismissal must close this screen exactly once: the script can fire both `modal.ondismiss` and an error.
  const closed = useRef(false);

  const close = useCallback(
    (outcome: "done" | "cancelled") => {
      if (closed.current) return;
      closed.current = true;
      router.back();
      // The wallet reads this on focus; it polls either way, so a wrong guess here costs nothing.
      if (outcome === "cancelled") return;
    },
    [router],
  );

  const html = useMemo(() => {
    const options = JSON.stringify({
      key: key_id,
      order_id,
      amount: Number(amount_minor) || 0,
      currency,
      name: name || "Katha",
      prefill: email ? { email } : undefined,
      theme: { color: colors.accent },
    });
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
  }, [key_id, order_id, amount_minor, currency, name, email]);

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
          originWhitelist={["*"]}
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
