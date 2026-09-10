/**
 * Hand-off between the wallet and the Razorpay checkout screen.
 *
 * Every file route is reachable through the `katha://` scheme, so anything the checkout screen read from its
 * route params — merchant key, order id, amount, the name painted on the page — could be supplied by a link.
 * The wallet parks what the screen needs here instead, in process memory only, right before it pushes the
 * route; the screen takes it on mount and finds nothing when it was opened any other way.
 *
 * Nothing here is persisted, and the store holds one session at a time: a second `open` replaces the first
 * and reports it as cancelled, so a stale resolver can never settle a later purchase.
 */

export type RazorpayCheckout = {
  orderId: string;
  keyId: string;
  amountMinor: number;
  currency: string;
  /** Merchant name shown on the Razorpay sheet. */
  name: string;
  email?: string | null;
};

export type CheckoutOutcome = "done" | "cancelled";

type Session = {
  checkout: RazorpayCheckout;
  resolve: (outcome: CheckoutOutcome) => void;
};

let current: Session | null = null;

/**
 * Park a checkout for the screen about to be pushed. Resolves once the screen reports how it closed; the
 * outcome is what the page said, never evidence of payment — the wallet still confirms with the server.
 */
export function openRazorpayCheckout(checkout: RazorpayCheckout): Promise<CheckoutOutcome> {
  current?.resolve("cancelled");
  return new Promise<CheckoutOutcome>((resolve) => {
    current = { checkout, resolve };
  });
}

/** Claim the parked checkout. Returns null when nothing is waiting — the screen was opened without the wallet. */
export function takeRazorpayCheckout(): { checkout: RazorpayCheckout; report: (outcome: CheckoutOutcome) => void } | null {
  const session = current;
  if (!session) return null;
  current = null;
  let reported = false;
  return {
    checkout: session.checkout,
    // Reported exactly once: the page can fire both `modal.ondismiss` and a failure for the same close.
    report: (outcome) => {
      if (reported) return;
      reported = true;
      session.resolve(outcome);
    },
  };
}

/** Drop whatever is parked, settling its promise as cancelled so no caller waits on a screen that never opened. */
export function clearRazorpayCheckout(): void {
  current?.resolve("cancelled");
  current = null;
}
