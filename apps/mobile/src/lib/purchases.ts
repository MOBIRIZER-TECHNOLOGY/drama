import * as WebBrowser from "expo-web-browser";
import { api } from "@/lib/api";
import { RequestError, unwrap } from "@/lib/errors";
import type { PurchaseOut } from "@/lib/types";

export const PURCHASE_RETURN_URL = "katha://purchase";

export type PurchaseResult =
  | { status: "paid"; purchase: PurchaseOut }
  | { status: "cancelled" }
  | { status: "pending"; purchaseId: string }
  | { status: "failed"; purchase: PurchaseOut };

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 60_000;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener("abort", done);
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

/** Poll `GET /v1/purchases/{id}` until the webhook marks it paid/failed, or give up after 60s / on abort. */
export async function pollPurchase(purchaseId: string, signal?: AbortSignal): Promise<PurchaseResult> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline && !signal?.aborted) {
    const purchase = unwrap(await api.GET("/v1/purchases/{purchase_id}", { params: { path: { purchase_id: purchaseId }, signal } }));
    if (purchase.status === "paid") return { status: "paid", purchase };
    if (purchase.status === "failed" || purchase.status === "refunded") return { status: "failed", purchase };
    await sleep(POLL_INTERVAL_MS, signal);
  }
  return { status: "pending", purchaseId };
}

export type CheckoutOptions = {
  packId: string;
  currency: string;
  /** ISO-3166 alpha-2 from the device locale, or `"*"`; the API also reads the CDN geo header. */
  country: string;
  /** Coupon typed by the user (upper-cased server-side) or the id of an offer card they tapped. */
  couponCode?: string | null;
  offerId?: string | null;
  signal?: AbortSignal;
};

/** Everything the wallet needs to show the price it is about to charge before the browser opens. */
export type CheckoutSession = { purchaseId: string; url: string; amount: number | null; discountPct: number | null; currency: string };

/**
 * `POST /v1/purchases/checkout`. Separate from opening the browser so the wallet can show the discounted
 * `amount` the server calculated (coupon and offer discounts are applied there, never client-side).
 */
export async function startStripeCheckout(opts: CheckoutOptions): Promise<CheckoutSession> {
  const checkout = unwrap(
    await api.POST("/v1/purchases/checkout", {
      body: {
        pack_id: opts.packId,
        gateway: "stripe",
        currency: opts.currency,
        country: opts.country,
        success_url: PURCHASE_RETURN_URL,
        cancel_url: PURCHASE_RETURN_URL,
        coupon_code: opts.couponCode?.trim() ? opts.couponCode.trim() : null,
        offer_id: opts.offerId ?? null,
      },
    }),
  );
  if (!checkout.checkout_url) {
    throw new RequestError({ code: "no_checkout_url", message: "Checkout is unavailable right now" });
  }
  return {
    purchaseId: checkout.purchase_id,
    url: checkout.checkout_url,
    amount: checkout.amount ?? null,
    discountPct: checkout.discount_pct ?? null,
    currency: checkout.currency,
  };
}

/** Open a started checkout in an auth session so the `katha://purchase` return closes it, then poll. */
export async function completeStripeCheckout(session: CheckoutSession, signal?: AbortSignal): Promise<PurchaseResult> {
  const checkout = { checkout_url: session.url, purchase_id: session.purchaseId };
  const result = await WebBrowser.openAuthSessionAsync(checkout.checkout_url, PURCHASE_RETURN_URL);
  if (result.type === "cancel" || result.type === "dismiss") {
    // The user may have paid and closed the sheet manually; one quick check before calling it cancelled.
    const purchase = unwrap(
      await api.GET("/v1/purchases/{purchase_id}", { params: { path: { purchase_id: checkout.purchase_id } } }),
    );
    if (purchase.status === "paid") return { status: "paid", purchase };
    return { status: "cancelled" };
  }
  return pollPurchase(checkout.purchase_id, signal);
}

/** Convenience for callers that do not need to show the price first. */
export async function buyWithStripe(opts: CheckoutOptions): Promise<PurchaseResult> {
  return completeStripeCheckout(await startStripeCheckout(opts), opts.signal);
}

/** Coupon and offer failures from `POST /v1/purchases/checkout`, in the words a viewer can act on. */
export function checkoutErrorMessage(code: string, fallback: string): string {
  switch (code) {
    case "coupon_invalid":
      return "That coupon code does not exist. Check the spelling and try again.";
    case "coupon_exhausted":
      return "This coupon has been fully redeemed.";
    case "coupon_inactive":
    case "coupon_expired":
      return "This coupon has expired.";
    case "coupon_region":
      return "This coupon is not valid in your region.";
    case "coupon_first_purchase":
      return "This coupon is for first purchases only.";
    case "offer_unavailable":
      return "This offer is no longer available.";
    case "offer_pack_mismatch":
      return "This offer applies to a different pack.";
    default:
      return fallback;
  }
}

/** True for the codes that mean the coupon/offer must be cleared before the purchase can proceed. */
export function isCouponError(code: string): boolean {
  return code.startsWith("coupon_") || code.startsWith("offer_");
}

/**
 * Phase 2 gateways. Razorpay needs its native Checkout SDK (react-native-razorpay) and RevenueCat needs
 * react-native-purchases; both require a dev client build. Typed here so callers can switch on `gateway`.
 */
export type Gateway = "stripe" | "razorpay" | "revenuecat";

export async function buyWithRazorpay(_opts: { packId: string; currency: string; country: string }): Promise<PurchaseResult> {
  // TODO(phase 2): POST /v1/purchases/checkout with gateway "razorpay", open RazorpayCheckout.open({ key: key_id,
  // order_id, amount: amount_minor, currency }) and poll the purchase like Stripe.
  throw new RequestError({ code: "not_implemented", message: "Razorpay checkout arrives in phase 2" });
}

export async function buyWithRevenueCat(_opts: { productId: string }): Promise<PurchaseResult> {
  // TODO(phase 2): Purchases.purchaseProduct(productId); the RevenueCat webhook credits coins server-side.
  throw new RequestError({ code: "not_implemented", message: "In-app purchases arrive in phase 2" });
}
