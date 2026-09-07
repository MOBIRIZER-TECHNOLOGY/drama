import { colors, radii, spacing } from "@katha/tokens";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Icon } from "@/components/icons";
import { Button, Card, EmptyState, ErrorState, Pill, Screen, Skeleton, Text, TextInput } from "@/components/ui";
import { useQuery } from "@/hooks/use-query";
import { useT } from "@/hooks/use-translations";
import { track } from "@/lib/analytics";
import { api } from "@/lib/api";
import { errorCode, errorMessage, unwrap } from "@/lib/errors";
import { formatDate, formatMoney } from "@/lib/format";
import {
  checkoutErrorMessage,
  completeStripeCheckout,
  isCouponError,
  pollPurchase,
  startStripeCheckout,
  type CheckoutSession,
  type PurchaseResult,
} from "@/lib/purchases";
import type { Offer, Pack } from "@/lib/types";
import { useAuth } from "@/providers/auth";
import { useConfig } from "@/providers/config";

export default function WalletScreen() {
  const t = useT();
  const router = useRouter();
  const {
    purchase_id: returnedPurchaseId,
    need: needParam,
    series: seriesParam,
    episode: episodeParam,
  } = useLocalSearchParams<{ purchase_id?: string; need?: string; series?: string; episode?: string }>();
  // The paywall sends how short the viewer is and where they were, so a top-up can end where it started rather
  // than dropping them on the wallet with no way back to the episode they wanted.
  const needCoins = Number(needParam ?? 0) || 0;
  const returnTo = seriesParam ? { pathname: "/player/[seriesId]" as const, params: { seriesId: seriesParam, ...(episodeParam ? { episode: episodeParam } : {}) } } : null;
  const { config, country } = useConfig();
  const { status, requireAuth, setBalance, refreshUser } = useAuth();
  const currency = config.economy.currency ?? "INR";
  const stripeEnabled = config.payments.gateways.includes("stripe");
  const symbol = config.economy.currency_symbol;
  const [buying, setBuying] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [coupon, setCoupon] = useState("");
  /** Coupon accepted by the server on the last checkout; kept so the next purchase reuses it. */
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(null);
  const [selectedOffer, setSelectedOffer] = useState<Offer | null>(null);
  /** Checkout the server priced and we are waiting for the viewer to confirm before opening the browser. */
  const [pending, setPending] = useState<{ session: CheckoutSession; pack: Pack } | null>(null);

  const wallet = useQuery(async () => unwrap(await api.GET("/v1/wallet")), [], { enabled: status === "signed_in" });
  const packs = useQuery(async () => unwrap(await api.GET("/v1/wallet/packs", { params: { query: { currency, country } } })), [currency, country]);
  // Offers are per viewer and time-boxed; the region comes from the X-Katha-Country header the client sets.
  const offers = useQuery(async () => unwrap(await api.GET("/v1/wallet/offers")), [country], { enabled: status === "signed_in" });

  // Cancels an in-flight purchase poll when the screen unmounts.
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  // useQuery returns a fresh object every render; the refetch functions themselves are stable.
  const refetchWallet = wallet.refetch;
  const refetchOffers = offers.refetch;

  const finish = useCallback(
    async (result: PurchaseResult) => {
      setBuying(null);
      setPending(null);
      if (result.status === "paid") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        track("checkout_return", { status: "paid", coins: result.purchase.coins_granted });
        setMessage({ tone: "success", text: `${result.purchase.coins_granted} coins added to your wallet.` });
        await refetchWallet({ silent: true });
        await refetchOffers({ silent: true });
        await refreshUser();
      } else if (result.status === "pending") {
        track("checkout_return", { status: "pending" });
        setMessage({ tone: "info", text: "Payment is still being confirmed. Your coins will appear shortly; pull to refresh." });
      } else if (result.status === "failed") {
        track("checkout_return", { status: "failed" });
        setMessage({ tone: "error", text: "Payment did not go through. You have not been charged." });
      } else {
        track("checkout_return", { status: "cancelled" });
        setMessage(null);
      }
    },
    [refetchWallet, refetchOffers, refreshUser],
  );

  /** Price the purchase server-side first: the viewer sees the discounted amount before the browser opens. */
  const buy = useCallback(
    async (pack: Pack) => {
      if (!requireAuth()) return;
      if (!stripeEnabled) {
        setMessage({ tone: "error", text: "Card payments are not enabled for this region yet." });
        return;
      }
      setBuying(pack.id);
      setMessage(null);
      const offerId = selectedOffer && (!selectedOffer.pack_id || selectedOffer.pack_id === pack.id) ? selectedOffer.id : null;
      const couponCode = coupon.trim() || appliedCoupon;
      track("checkout_start", { pack_id: pack.id, currency, country, has_coupon: Boolean(couponCode), offer_id: offerId });
      try {
        abortRef.current?.abort();
        abortRef.current = new AbortController();
        const session = await startStripeCheckout({
          packId: pack.id,
          currency,
          country,
          // A typed coupon wins over a selected offer card; the API resolves only one of the two.
          couponCode,
          offerId: couponCode ? null : offerId,
          signal: abortRef.current.signal,
        });
        if (couponCode) setAppliedCoupon(couponCode.toUpperCase());
        setPending({ session, pack });
        setBuying(null);
      } catch (e) {
        const code = errorCode(e);
        setMessage({ tone: "error", text: checkoutErrorMessage(code, errorMessage(e)) });
        if (isCouponError(code)) {
          setAppliedCoupon(null);
          setSelectedOffer(null);
        }
        setBuying(null);
      }
    },
    [requireAuth, stripeEnabled, currency, country, coupon, appliedCoupon, selectedOffer],
  );

  /** Second step: the viewer accepted the priced checkout, so hand off to Stripe and poll. */
  const confirm = useCallback(async () => {
    if (!pending) return;
    const { session } = pending;
    setBuying(pending.pack.id);
    setMessage({ tone: "info", text: "Opening secure checkout…" });
    try {
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      await finish(await completeStripeCheckout(session, abortRef.current.signal));
    } catch (e) {
      setBuying(null);
      setPending(null);
      setMessage({ tone: "error", text: errorMessage(e) });
    }
  }, [pending, finish]);

  useEffect(() => {
    if (wallet.data) setBalance(wallet.data.coin_balance);
  }, [wallet.data, setBalance]);

  // Arrived through the katha://purchase deep link while the app was closed: confirm that purchase.
  useEffect(() => {
    if (!returnedPurchaseId || status !== "signed_in") return;
    const controller = new AbortController();
    pollPurchase(returnedPurchaseId, controller.signal)
      .then(async (result) => {
        if (controller.signal.aborted) return;
        if (result.status === "paid") {
          track("checkout_return", { status: "paid", coins: result.purchase.coins_granted, deep_link: true });
          setMessage({ tone: "success", text: `${result.purchase.coins_granted} coins added to your wallet.` });
          await refetchWallet({ silent: true });
          await refreshUser();
        } else if (result.status === "pending") {
          setMessage({ tone: "info", text: "Payment is still being confirmed. Pull to refresh in a moment." });
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, [returnedPurchaseId, status, refetchWallet, refreshUser]);

  if (status !== "signed_in") {
    return (
      <Screen>
        <View style={styles.header}>
          <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/me"))} accessibilityRole="button" accessibilityLabel="Back" hitSlop={10}>
            <Icon name="back" size={30} />
          </Pressable>
          <Text variant="title">{t("wallet.title")}</Text>
          <View style={{ width: 30 }} />
        </View>
        <EmptyState
          title="Sign in to see your wallet"
          body="Coins and purchases are tied to your account."
          action={<Button title={t("common.sign_in")} onPress={() => requireAuth()} disabled={status === "loading"} />}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/me"))} accessibilityRole="button" accessibilityLabel="Back" hitSlop={10}>
          <Icon name="back" size={30} />
        </Pressable>
        <Text variant="title">{t("wallet.title")}</Text>
        <Pressable onPress={() => router.push("/wallet/ledger")} accessibilityRole="button" hitSlop={8}>
          <Text variant="caption" color={colors.accent}>
            History
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {returnTo ? (
          <Card style={styles.returnCard}>
            <Text variant="label" style={{ flex: 1 }}>
              {needCoins > 0 ? t("player.unlock_need", { n: needCoins }) : t("wallet.top_up")}
            </Text>
            <Button title={t("wallet.back_to_episode")} small variant="ghost" onPress={() => router.replace(returnTo)} />
          </Card>
        ) : null}

        <Card style={styles.balanceCard}>
          <Text variant="caption">{t("player.balance")}</Text>
          <View style={styles.balanceRow}>
            <Icon name="coin" size={22} />
            {wallet.loading ? <Skeleton width={80} height={32} /> : <Text variant="display">{wallet.data?.coin_balance ?? "—"}</Text>}
          </View>
          {wallet.data?.is_vip ? <Pill label={wallet.data.vip_ends_at ? `VIP until ${formatDate(wallet.data.vip_ends_at)}` : "VIP"} tone="gold" /> : null}
          {wallet.error ? (
            <Text variant="caption" color={colors.danger}>
              {wallet.error}
            </Text>
          ) : null}
        </Card>

        {message ? (
          <Text variant="body" color={message.tone === "error" ? colors.danger : message.tone === "success" ? colors.success : colors.ink2} style={styles.message}>
            {message.text}
          </Text>
        ) : null}

        {(offers.data?.length ?? 0) > 0 ? (
          <View style={styles.offers}>
            <Text variant="heading">{t("wallet.offers_title")}</Text>
            {offers.data?.map((offer) => (
              <OfferCard
                key={offer.id}
                offer={offer}
                selected={selectedOffer?.id === offer.id}
                onPress={() => {
                  setSelectedOffer((current) => (current?.id === offer.id ? null : offer));
                  setMessage(null);
                }}
              />
            ))}
          </View>
        ) : null}

        <Card style={styles.couponCard}>
          <Text variant="label">{t("wallet.coupon")}</Text>
          <View style={styles.couponRow}>
            <TextInput
              placeholder="Enter code"
              value={coupon}
              onChangeText={(v) => setCoupon(v.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={32}
              style={{ flex: 1 }}
              accessibilityLabel={t("wallet.coupon")}
            />
            {coupon || appliedCoupon ? (
              <Button
                title="Clear"
                variant="ghost"
                small
                onPress={() => {
                  setCoupon("");
                  setAppliedCoupon(null);
                  setMessage(null);
                }}
              />
            ) : null}
          </View>
          <Text variant="caption">
            {appliedCoupon ? `${appliedCoupon} will be applied at checkout.` : "Codes are checked when you pick a pack; the discounted price is shown before you pay."}
          </Text>
        </Card>

        <Text variant="heading" style={styles.sectionTitle}>
          {t("wallet.top_up")}
        </Text>
        {packs.loading ? (
          <View style={styles.grid}>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} width="48%" height={120} />
            ))}
          </View>
        ) : packs.error && !packs.data ? (
          <ErrorState message={packs.error} onRetry={() => packs.refetch({ silent: false })} retryLabel={t("common.retry")} />
        ) : (packs.data?.length ?? 0) === 0 ? (
          <EmptyState title={t("wallet.packs_empty")} />
        ) : (
          <View style={styles.grid}>
            {packs.data?.map((pack) => (
              <PackCard
                key={pack.id}
                pack={pack}
                currency={currency}
                symbol={symbol}
                busy={buying === pack.id}
                disabled={buying !== null || pending !== null || !stripeEnabled}
                discountPct={selectedOffer && (!selectedOffer.pack_id || selectedOffer.pack_id === pack.id) ? selectedOffer.discount_pct : null}
                onBuy={() => buy(pack)}
              />
            ))}
          </View>
        )}
        <Text variant="caption" style={styles.footnote}>
          {stripeEnabled ? "Payments are processed by Stripe." : "Payments are not available in this build yet."} Coins are credited once the payment is confirmed. In-app purchases and Razorpay are coming in a later
          release.
        </Text>
      </ScrollView>

      {pending ? (
        <View style={styles.confirmWrap} pointerEvents="box-none">
          <Pressable
            style={styles.scrim}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            onPress={() => {
              setPending(null);
              setBuying(null);
            }}
          />
          <View style={styles.confirmSheet}>
            <View style={styles.handle} />
            <Text variant="title">{pending.pack.name}</Text>
            <View style={styles.confirmRow}>
              <Text variant="body">Total</Text>
              <View style={styles.confirmPrice}>
                {pending.session.discountPct && pending.pack.price ? (
                  <Text variant="caption" style={styles.strike}>
                    {formatMoney(pending.pack.price.amount, pending.session.currency, symbol)}
                  </Text>
                ) : null}
                <Text variant="title">
                  {pending.session.amount !== null
                    ? formatMoney(pending.session.amount, pending.session.currency, symbol)
                    : pending.pack.price
                      ? formatMoney(pending.pack.price.amount, pending.pack.price.currency, symbol)
                      : "—"}
                </Text>
              </View>
            </View>
            {pending.session.discountPct ? <Pill label={`${pending.session.discountPct}% off applied`} tone="success" /> : null}
            <Button title="Continue to payment" onPress={confirm} loading={buying === pending.pack.id} />
            <Button
              title={t("common.cancel")}
              variant="ghost"
              onPress={() => {
                setPending(null);
                setBuying(null);
              }}
              disabled={buying !== null}
            />
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

/** Countdown to `ends_at`; null once it has passed (the card then reads as a plain offer). */
function useCountdown(endsAt: string | null): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!endsAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [endsAt]);
  return useMemo(() => {
    if (!endsAt) return null;
    const end = Date.parse(endsAt);
    if (Number.isNaN(end)) return null;
    const left = Math.floor((end - now) / 1000);
    if (left <= 0) return null;
    const days = Math.floor(left / 86400);
    const h = Math.floor((left % 86400) / 3600);
    const m = Math.floor((left % 3600) / 60);
    const s = left % 60;
    if (days > 0) return `${days}d ${h}h left`;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")} left`;
  }, [endsAt, now]);
}

function OfferCard({ offer, selected, onPress }: { offer: Offer; selected: boolean; onPress: () => void }) {
  const countdown = useCountdown(offer.ends_at);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }}>
      <Card style={[styles.offer, selected && styles.offerSelected]}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label">{offer.title}</Text>
          <Text variant="caption">
            {offer.pack_id ? "Applies to one pack" : "Applies to any pack"}
            {countdown ? ` · ${countdown}` : ""}
          </Text>
        </View>
        {offer.discount_pct ? <Pill label={`${offer.discount_pct}% off`} tone={selected ? "success" : "accent"} /> : null}
      </Card>
    </Pressable>
  );
}

function PackCard({
  pack,
  currency,
  symbol,
  busy,
  disabled,
  discountPct,
  onBuy,
}: {
  pack: Pack;
  currency: string;
  symbol?: string;
  busy: boolean;
  disabled: boolean;
  discountPct?: number | null;
  onBuy: () => void;
}) {
  const price = pack.price ? formatMoney(pack.price.amount, pack.price.currency, pack.price.currency === currency ? symbol : undefined) : null;
  return (
    <Card style={[styles.pack, pack.kind === "vip" && styles.packVip, Boolean(discountPct) && styles.packOffer]}>
      {pack.badge ? <Pill label={pack.badge} tone="accent" style={styles.packBadge} /> : null}
      <View style={styles.packHead}>
        {pack.kind === "vip" ? (
          <>
            <Text variant="title" color={colors.gold}>
              VIP
            </Text>
            <Text variant="caption">{pack.duration_days ? `${pack.duration_days} days` : pack.name}</Text>
          </>
        ) : (
          <>
            <View style={styles.packCoins}>
              <Icon name="coin" size={16} />
              <Text variant="title">{pack.coins}</Text>
            </View>
            {pack.bonus_coins > 0 ? (
              <Text variant="caption" color={colors.success}>
                +{pack.bonus_coins} bonus
              </Text>
            ) : null}
          </>
        )}
      </View>
      <Text variant="caption" numberOfLines={1}>
        {pack.name}
      </Text>
      {discountPct ? (
        <Text variant="caption" color={colors.success}>
          {discountPct}% off applied
        </Text>
      ) : null}
      <Button title={price ?? "Unavailable"} variant={pack.kind === "vip" ? "gold" : "primary"} small loading={busy} disabled={disabled || !price} onPress={onBuy} style={styles.packBtn} />
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  returnCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderColor: colors.gold },
  balanceCard: { gap: spacing.sm, borderColor: colors.gold, borderRadius: radii.lg },
  balanceRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  message: { textAlign: "center" },
  offers: { gap: spacing.sm },
  offer: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  offerSelected: { borderColor: colors.accent },
  couponCard: { gap: spacing.sm },
  couponRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  sectionTitle: { marginTop: spacing.sm },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  pack: { width: "48%", flexGrow: 1, gap: spacing.xs },
  packVip: { borderColor: colors.gold },
  packOffer: { borderColor: colors.success },
  packBadge: { position: "absolute", top: -8, right: spacing.sm },
  packHead: { gap: 2 },
  packCoins: { flexDirection: "row", alignItems: "center", gap: 6 },
  packBtn: { marginTop: spacing.sm },
  footnote: { textAlign: "center" },
  confirmWrap: { ...StyleSheet.absoluteFill, justifyContent: "flex-end" } as const,
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.5)" } as const,
  confirmSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    padding: spacing.xl,
    gap: spacing.md,
  },
  handle: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: colors.line, marginTop: -spacing.sm },
  confirmRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  confirmPrice: { alignItems: "flex-end" },
  strike: { textDecorationLine: "line-through" },
});
