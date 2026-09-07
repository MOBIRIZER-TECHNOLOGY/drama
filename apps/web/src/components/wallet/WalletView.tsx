"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { track } from "@/lib/analytics";
import { useApp, useHref, useT } from "@/lib/app-context";
import { useAuth } from "@/lib/auth-context";
import { clientApi } from "@/lib/client-api";
import { call, type ApiError } from "@/lib/errors";
import { useLoader } from "@/lib/use-loader";
import { formatCoins, formatDate, formatMoney } from "@/lib/format";
import { useToast } from "@/lib/toast";
import { colors } from "@/lib/tokens";
import type { CheckoutOut, OfferOut, PackOut, PurchaseOut, WalletOut } from "@/lib/types";
import { PageTitle, RequireAuth } from "../RequireAuth";
import { Button, buttonClass } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { EmptyState, ErrorState, Skeleton } from "../ui/states";
import { IconCheck, IconClock, IconCoin, Spinner } from "../ui/icons";
import { OffersPanel, useOfferErrorMessage } from "./OffersPanel";

type Gateway = "stripe" | "razorpay";

type PurchaseFlow =
  | { kind: "idle" }
  | { kind: "checkout"; pack: PackOut }
  /** A discount was applied: show the new price and let the viewer confirm before leaving for the gateway. */
  | { kind: "confirm"; out: CheckoutOut; pack: PackOut }
  | { kind: "polling"; purchaseId: string; startedAt: number }
  | { kind: "paid"; purchase: PurchaseOut }
  | { kind: "pending"; purchaseId: string }
  | { kind: "failed"; purchaseId: string | null; message: string };

const POLL_MS = 2000;
const POLL_MAX_MS = 60_000;

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open(): void };
  }
}

/** Only ever navigate to Stripe's own checkout host. */
function isStripeCheckoutUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && (u.host === "checkout.stripe.com" || u.host.endsWith(".checkout.stripe.com"));
  } catch {
    return false;
  }
}

function loadRazorpay(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const existing = document.querySelector<HTMLScriptElement>('script[data-razorpay="1"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(!!window.Razorpay), { once: true });
      existing.addEventListener("error", () => resolve(false), { once: true });
      return;
    }
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.async = true;
    s.dataset.razorpay = "1";
    s.onload = () => resolve(!!window.Razorpay);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
}

export function WalletView() {
  return (
    <RequireAuth>
      <WalletInner />
    </RequireAuth>
  );
}

function WalletInner() {
  const t = useT();
  const href = useHref();
  const router = useRouter();
  const toast = useToast();
  const search = useSearchParams();
  const { config, lang } = useApp();
  const { user, refreshUser } = useAuth();
  const offerMessage = useOfferErrorMessage();
  const currency = (config?.economy?.currency ?? "INR").toUpperCase();
  const episodePrice = config?.economy?.episode_price ?? 0;
  // Where the viewer was headed before they ran out of coins, and how many they needed. The paywall passes both,
  // so a top-up can end where it started instead of stranding them on the wallet.
  const nextPath = search.get("next");
  const needCoins = Number(search.get("need") ?? 0) || 0;
  // Only ever return to a path inside this site: `next` arrives in a URL and must not become an open redirect.
  const returnHref = nextPath && nextPath.startsWith("/") && !nextPath.startsWith("//") ? href(nextPath) : null;
  // Gateways the server has configured and enabled, in display order. Unknown names are ignored.
  const gateways = useMemo(
    () => (config?.payments?.gateways ?? []).filter((g): g is Gateway => g === "stripe" || g === "razorpay"),
    [config?.payments?.gateways],
  );

  const [wallet, setWallet] = useState<WalletOut | null>(null);
  const [packs, setPacks] = useState<PackOut[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  // UPI is the overwhelming default in India, so when we are charging in rupees Razorpay leads if it is available.
  const [gateway, setGateway] = useState<Gateway>(
    () => (currency === "INR" && gateways.includes("razorpay") ? "razorpay" : gateways[0]) ?? "stripe",
  );
  const [offers, setOffers] = useState<OfferOut[] | null>(null);
  const [offerId, setOfferId] = useState<string | null>(null);
  const [coupon, setCoupon] = useState("");
  const [couponError, setCouponError] = useState<string | null>(null);
  const [flow, setFlow] = useState<PurchaseFlow>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollGen = useRef(0);

  const load = useCallback(async () => {
    const [w, p, o] = await Promise.all([
      call(() => clientApi.GET("/v1/wallet")),
      call(() => clientApi.GET("/v1/wallet/packs", { params: { query: { currency, country: "*" } } })),
      call(() => clientApi.GET("/v1/wallet/offers")),
    ]);
    if (w.error) return setError(w.error);
    if (p.error) return setError(p.error);
    setError(null);
    setWallet(w.data);
    setPacks(p.data);
    // Offers are a bonus: a failure here leaves the packs usable.
    setOffers(o.data ?? []);
    setOfferId((id) => (id && o.data?.some((x) => x.id === id) ? id : null));
  }, [currency]);

  useLoader(load);

  const stopPolling = () => {
    pollGen.current += 1;
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollTimer.current = null;
  };

  const poll = useCallback(
    (purchaseId: string, startedAt: number) => {
      stopPolling();
      const gen = pollGen.current;
      const tick = async () => {
        const { data, error } = await call(() =>
          clientApi.GET("/v1/purchases/{purchase_id}", { params: { path: { purchase_id: purchaseId } } }),
        );
        if (gen !== pollGen.current) return; // a newer poll replaced this one
        if (error && error.status === 404) {
          setFlow({ kind: "failed", purchaseId, message: t("wallet.purchase_not_found", "We could not find this purchase.") });
          return;
        }
        if (data?.status === "paid") {
          setFlow({ kind: "paid", purchase: data });
          await Promise.all([refreshUser(), load()]);
          return;
        }
        if (data?.status === "failed" || data?.status === "refunded") {
          setFlow({ kind: "failed", purchaseId, message: t("wallet.purchase_failed", "The payment did not go through.") });
          return;
        }
        if (Date.now() - startedAt > POLL_MAX_MS) {
          setFlow({ kind: "pending", purchaseId });
          return;
        }
        pollTimer.current = setTimeout(tick, POLL_MS);
      };
      setFlow({ kind: "polling", purchaseId, startedAt });
      void tick();
    },
    [load, refreshUser, t],
  );

  // Return from Stripe: the API appends ?purchase_id=… to success_url (the brief calls it ?purchase=).
  useEffect(() => {
    const id = search.get("purchase_id") ?? search.get("purchase");
    if (id) {
      track("checkout_return", { purchase_id: id, status: "returned" });
      poll(id, Date.now());
      router.replace(href("/wallet"), { scroll: false });
    } else if (search.get("cancelled")) {
      track("checkout_return", { purchase_id: null, status: "cancelled" });
      toast(t("wallet.cancelled", "Payment cancelled."), "info");
      router.replace(href("/wallet"), { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => stopPolling(), []);

  const checkout = async (pack: PackOut) => {
    setBusy(true);
    setCouponError(null);
    const origin = window.location.origin;
    const code = coupon.trim();
    track("checkout_start", {
      pack_id: pack.id,
      gateway,
      currency,
      amount: pack.price?.amount ?? null,
      coupon: code ? code : null,
      offer_id: offerId,
    });
    const { data, error } = await call(() =>
      clientApi.POST("/v1/purchases/checkout", {
        body: {
          pack_id: pack.id,
          gateway,
          currency,
          country: "*",
          success_url: `${origin}${href("/wallet")}`,
          cancel_url: `${origin}${href("/wallet")}?cancelled=1`,
          ...(code ? { coupon_code: code } : {}),
          ...(offerId ? { offer_id: offerId } : {}),
        },
      }),
    );
    if (error) {
      setBusy(false);
      const message = offerMessage(error.code, error.message);
      // Coupon and offer problems belong next to the field, not in a toast that hides the fix.
      if (error.code.startsWith("coupon_") || error.code === "offer_unavailable") setCouponError(message);
      else toast(message, "error");
      return;
    }
    // A discount was priced by the API: show what will be charged before leaving the site.
    if (data.discount_pct) {
      setBusy(false);
      setFlow({ kind: "confirm", out: data, pack });
      return;
    }
    await proceed(data, pack);
  };

  /** Hand the (possibly discounted) checkout over to the gateway. */
  const proceed = async (out: CheckoutOut, pack: PackOut) => {
    setBusy(true);
    if (out.gateway === "stripe") {
      if (out.checkout_url && isStripeCheckoutUrl(out.checkout_url)) {
        window.location.assign(out.checkout_url);
        return;
      }
      setBusy(false);
      toast(t("wallet.no_checkout_url", "Stripe did not return a valid checkout link."), "error");
      return;
    }
    await openRazorpay(out, pack);
    setBusy(false);
  };

  const openRazorpay = async (out: CheckoutOut, pack: PackOut) => {
    const ok = await loadRazorpay();
    if (!ok || !window.Razorpay || !out.order_id || !out.key_id) {
      toast(t("wallet.razorpay_unavailable", "Razorpay could not be loaded. Try Stripe instead."), "error");
      return;
    }
    const rzp = new window.Razorpay({
      key: out.key_id,
      order_id: out.order_id,
      amount: out.amount_minor ?? undefined,
      currency: out.currency,
      name: config?.site?.name ?? "Katha",
      description: pack.name,
      prefill: { email: user?.email ?? undefined, contact: user?.phone ?? undefined, name: user?.display_name ?? undefined },
      theme: { color: colors.accent, backdrop_color: "rgba(20,16,19,0.85)" },
      handler: () => poll(out.purchase_id, Date.now()),
      modal: {
        ondismiss: () => setFlow((f) => (f.kind === "checkout" ? { kind: "idle" } : f)),
        confirm_close: true,
      },
    });
    setFlow({ kind: "checkout", pack });
    rzp.open();
  };

  if (error) {
    return <ErrorState error={error} onRetry={load} />;
  }

  return (
    <div>
      <PageTitle
        sub={t("wallet.subtitle", "Coins unlock episodes. Packs never expire.")}
        aside={
          <Link href={href("/wallet/history")} className={buttonClass("secondary", "sm")}>
            <IconClock size={16} />
            {t("wallet.history", "History")}
          </Link>
        }
      >
        {t("wallet.title", "Wallet")}
      </PageTitle>

      {/* Arriving from a paywall: say why, say how short they are, and keep the way back visible the whole time. */}
      {returnHref && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gold/40 bg-gold/5 px-4 py-3">
          <p className="text-sm text-ink2">
            {needCoins > 0
              ? t("wallet.need_coins", "You need {n} more coins to keep watching.", { n: formatCoins(needCoins, lang) })
              : t("wallet.came_from_episode", "Top up and go straight back to your episode.")}
          </p>
          <Link href={returnHref} className={buttonClass("ghost", "sm")}>
            {t("wallet.back_to_episode", "Back to the episode")}
          </Link>
        </div>
      )}

      {/* Balance */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-gold/40 bg-surface p-5">
          <p className="text-xs uppercase tracking-wide text-muted">{t("wallet.balance", "Coin balance")}</p>
          {wallet ? (
            <p className="font-display mt-1 flex items-center gap-2 text-4xl font-bold text-gold">
              <IconCoin size={32} />
              {wallet.coin_balance}
            </p>
          ) : (
            <Skeleton className="mt-2 h-10 w-32" />
          )}
        </div>
        <div className="rounded-lg border border-line bg-surface p-5">
          <p className="text-xs uppercase tracking-wide text-muted">{t("wallet.vip", "VIP")}</p>
          {wallet ? (
            <p className="mt-1 text-lg text-ink">
              {wallet.is_vip ? (
                <span className="text-success">
                  {t("wallet.vip_active", "Active")}
                  {wallet.vip_ends_at ? ` · ${t("wallet.until", "until")} ${formatDate(wallet.vip_ends_at, lang)}` : ""}
                </span>
              ) : (
                <span className="text-muted">{t("wallet.vip_inactive", "Not active — VIP unlocks every episode.")}</span>
              )}
            </p>
          ) : (
            <Skeleton className="mt-2 h-7 w-48" />
          )}
        </div>
      </div>

      <OffersPanel
        offers={offers}
        selectedOfferId={offerId}
        onSelectOffer={(id) => {
          setOfferId(id);
          setCouponError(null);
        }}
        coupon={coupon}
        onCouponChange={(v) => {
          setCoupon(v);
          setCouponError(null);
        }}
        couponError={couponError}
        busy={busy}
      />

      {/* Gateway */}
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-semibold text-ink">{t("wallet.packs", "Coin packs")}</h2>
        {gateways.length > 1 && (
          <fieldset className="flex items-center gap-1 rounded-pill border border-line bg-surface p-1 text-sm">
            <legend className="sr-only">{t("wallet.pay_with", "Pay with")}</legend>
            {gateways.map((g) => (
            <label key={g} className={`cursor-pointer rounded-pill px-3 py-1 ${gateway === g ? "bg-surface2 text-ink" : "text-muted hover:text-ink"}`}>
              <input type="radio" name="gateway" value={g} checked={gateway === g} onChange={() => setGateway(g)} className="sr-only" />
              {g === "razorpay" ? "Razorpay" : "Stripe"}
            </label>
          ))}
          </fieldset>
        )}
      </div>
      {gateways.length === 0 && packs && packs.length > 0 && (
        <p className="mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          {t("wallet.no_gateways", "Payments are not available right now. Please check back later.")}
        </p>
      )}

      {/* Packs */}
      {!packs ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-44 w-full rounded-lg" />
          ))}
        </div>
      ) : packs.length === 0 ? (
        <EmptyState className="mt-4" title={t("wallet.no_packs", "No packs available right now")} message={t("wallet.no_packs_hint", "Check back soon, or earn free coins in Rewards.")} />
      ) : (
        <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {packs.map((p) => (
            <li key={p.id} className={`relative flex flex-col rounded-lg border bg-surface p-5 ${p.badge ? "border-gold/50" : "border-line"}`}>
              {p.badge && (
                <span className="absolute -top-2.5 start-4 rounded-pill bg-gold px-2 py-0.5 text-[11px] font-semibold uppercase text-accent-ink">{p.badge}</span>
              )}
              <p className="font-display text-lg font-semibold text-ink">{p.name}</p>
              {/*
                A subscription's headline is its duration, not its coin count. VIP packs are seeded with
                coins = 0, so rendering `p.coins` for every pack made the subscription advertise "0" in 30px
                gold as the reason to buy it.
              */}
              {p.kind === "vip" ? (
                <>
                  <p className="mt-3 font-display text-3xl font-bold text-gold">
                    {t("wallet.vip_days", "{n} days", { n: p.duration_days ?? 30 })}
                  </p>
                  <p className="mt-1 text-sm text-ink2">{t("wallet.vip_benefit", "Every episode, no coins needed")}</p>
                </>
              ) : (
                <p className="mt-3 flex items-baseline gap-2">
                  <span className="inline-flex items-center gap-1 font-display text-3xl font-bold text-gold">
                    <IconCoin size={24} />
                    {formatCoins(p.coins + p.bonus_coins, lang)}
                  </span>
                  {p.bonus_coins > 0 && (
                    <span className="rounded-pill bg-success/15 px-2 py-0.5 text-xs font-semibold text-success">
                      {t("wallet.bonus_pct", "+{pct}% extra", { pct: Math.round((p.bonus_coins / Math.max(1, p.coins)) * 100) })}
                    </span>
                  )}
                </p>
              )}
              {/* An abstract currency is unpriceable until it is tied to the thing it buys. */}
              {p.kind !== "vip" && episodePrice > 0 && (
                <p className="mt-1 text-sm text-ink2">
                  {t("wallet.equivalent", "About {n} episodes", { n: Math.floor((p.coins + p.bonus_coins) / episodePrice) })}
                  {p.price ? (
                    <span className="text-muted">
                      {" · "}
                      {t("wallet.per_episode", "{price} each", {
                        price: formatMoney(
                          Math.round((p.price.amount / Math.max(1, Math.floor((p.coins + p.bonus_coins) / episodePrice))) * 100) / 100,
                          p.price.currency,
                          lang,
                        ),
                      })}
                    </span>
                  ) : null}
                </p>
              )}
              {p.description && <p className="mt-2 text-sm text-muted">{p.description}</p>}
              <div className="mt-auto pt-4">
                {p.price ? (
                  <Button size="lg" className="w-full" loading={busy} disabled={gateways.length === 0} onClick={() => void checkout(p)}>
                    {p.kind === "vip"
                      ? t("wallet.buy_vip_cta", "Go VIP · {price}", { price: formatMoney(p.price.amount, p.price.currency, lang) })
                      : t("wallet.buy_cta", "Get coins · {price}", { price: formatMoney(p.price.amount, p.price.currency, lang) })}
                  </Button>
                ) : (
                  <Button size="lg" className="w-full" disabled>
                    {t("wallet.unavailable", "Unavailable in {currency}", { currency })}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-xs text-muted">
        {t("wallet.secure_note", "Payments are processed by {gateways}. Coins are credited after the payment is confirmed.", {
          gateways: gateways.map((g) => (g === "razorpay" ? "Razorpay" : "Stripe")).join(" / ") || "our payment partner",
        })}
      </p>

      <PurchaseDialog
        flow={flow}
        busy={busy}
        onClose={() => setFlow({ kind: "idle" })}
        onCheckAgain={(id) => poll(id, Date.now())}
        onConfirm={(out, pack) => void proceed(out, pack)}
        returnHref={returnHref}
      />
    </div>
  );
}

function PurchaseDialog({
  flow,
  busy,
  onClose,
  onCheckAgain,
  onConfirm,
  returnHref,
}: {
  flow: PurchaseFlow;
  busy: boolean;
  onClose: () => void;
  onCheckAgain: (id: string) => void;
  onConfirm: (out: CheckoutOut, pack: PackOut) => void;
  /** Where the viewer was headed when they ran out of coins, so success can return them there. */
  returnHref: string | null;
}) {
  const t = useT();
  const { lang } = useApp();
  const open =
    flow.kind === "polling" || flow.kind === "paid" || flow.kind === "pending" || flow.kind === "failed" || flow.kind === "confirm";
  const title =
    flow.kind === "confirm"
      ? t("wallet.discount_title", "Your discount is applied")
      : flow.kind === "paid"
      ? t("wallet.paid_title", "Coins added")
      : flow.kind === "failed"
        ? t("wallet.failed_title", "Payment failed")
        : flow.kind === "pending"
          ? t("wallet.pending_title", "Still confirming")
          : t("wallet.confirming_title", "Confirming your payment");
  return (
    <Dialog open={open} onClose={onClose} title={title} size="sm" closeLabel={t("common.close", "Close")}>
      <div className="flex flex-col items-center gap-4 py-2 text-center">
        {flow.kind === "confirm" && (
          <>
            <p className="text-sm text-muted">{flow.pack.name}</p>
            <p className="flex items-baseline gap-2">
              {flow.pack.price && flow.out.amount != null && flow.out.amount < flow.pack.price.amount && (
                <span className="text-sm text-muted line-through">{formatMoney(flow.pack.price.amount, flow.out.currency, lang)}</span>
              )}
              <span className="font-display text-3xl font-bold text-gold">
                {formatMoney(flow.out.amount ?? flow.pack.price?.amount ?? 0, flow.out.currency, lang)}
              </span>
            </p>
            {flow.out.discount_pct ? (
              <p className="rounded-pill bg-gold/15 px-3 py-1 text-sm font-medium text-gold">
                {t("wallet.offer_discount", "{pct}% off", { pct: flow.out.discount_pct })}
              </p>
            ) : null}
            <div className="flex w-full gap-2">
              <Button variant="secondary" onClick={onClose} className="flex-1" disabled={busy}>
                {t("common.cancel", "Cancel")}
              </Button>
              <Button loading={busy} onClick={() => onConfirm(flow.out, flow.pack)} className="flex-1">
                {t("wallet.continue_to_payment", "Continue to payment")}
              </Button>
            </div>
          </>
        )}
        {flow.kind === "polling" && (
          <>
            <Spinner size={36} className="text-accent" />
            <p className="text-sm text-muted">{t("wallet.confirming", "Waiting for the payment provider to confirm. This usually takes a few seconds.")}</p>
          </>
        )}
        {flow.kind === "paid" && (
          <>
            <span className="rounded-pill bg-success/15 p-3 text-success">
              <IconCheck size={28} />
            </span>
            <p className="font-display text-2xl font-bold text-gold">
              +{flow.purchase.coins_granted} {t("wallet.coins", "coins")}
            </p>
            <p className="text-sm text-muted">
              {formatMoney(flow.purchase.amount, flow.purchase.currency, lang)} · {formatDate(flow.purchase.paid_at ?? flow.purchase.created_at, lang)}
            </p>
            {returnHref ? (
              <Link href={returnHref} className={buttonClass("gold", "md", "w-full")}>
                {t("wallet.back_to_episode", "Back to the episode")}
              </Link>
            ) : (
              <Button onClick={onClose} className="w-full">
                {t("common.done", "Done")}
              </Button>
            )}
          </>
        )}
        {flow.kind === "pending" && (
          <>
            <IconClock size={32} className="text-warning" />
            <p className="text-sm text-muted">
              {t("wallet.pending", "The provider has not confirmed yet. Your coins will appear automatically once it does — you can also check again.")}
            </p>
            <div className="flex w-full gap-2">
              <Button variant="secondary" onClick={onClose} className="flex-1">
                {t("common.close", "Close")}
              </Button>
              <Button onClick={() => onCheckAgain(flow.purchaseId)} className="flex-1">
                {t("wallet.check_again", "Check again")}
              </Button>
            </div>
          </>
        )}
        {flow.kind === "failed" && (
          <>
            <p className="text-sm text-danger">{flow.message}</p>
            <Button variant="secondary" onClick={onClose} className="w-full">
              {t("common.close", "Close")}
            </Button>
          </>
        )}
      </div>
    </Dialog>
  );
}
