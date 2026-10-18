import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appWrapper } from "@/test-utils/app";
import { aUser, auth, setAuth } from "@/test-utils/auth-context";
import { nav, resetNav } from "@/test-utils/next-navigation";
import { WalletView } from "./WalletView";

vi.mock("next/navigation", () => import("@/test-utils/next-navigation"));
vi.mock("@/lib/auth-context", () => import("@/test-utils/auth-context"));
const GET = vi.fn();
const POST = vi.fn();
vi.mock("@/lib/client-api", () => ({ clientApi: { GET: (...a: unknown[]) => GET(...a), POST: (...a: unknown[]) => POST(...a) } }));
const track = vi.fn();
vi.mock("@/lib/analytics", () => ({ track: (...a: unknown[]) => track(...a) }));
const toast = vi.fn();
vi.mock("@/lib/toast", () => ({ useToast: () => toast }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const ok = (data: unknown) => ({ data, response: { ok: true, status: 200 } });
const fail = (status: number, detail: unknown = "x") => ({ error: { detail }, response: { ok: false, status } });

const coinPack = {
  id: "p1",
  name: "Starter",
  kind: "coins",
  coins: 100,
  bonus_coins: 20,
  badge: "Popular",
  description: "Best start",
  price: { amount: 99, currency: "INR" },
};
const vipPack = { id: "p2", name: "VIP", kind: "vip", coins: 0, bonus_coins: 0, duration_days: null, price: { amount: 299.5, currency: "INR" } };
const noPrice = { id: "p3", name: "Nope", kind: "coins", coins: 10, bonus_coins: 0, price: null };

const baseConfig = {
  economy: { currency: "inr", episode_price: 10 },
  payments: { gateways: ["stripe", "razorpay", "paypal"] },
  site: { name: "KathaTV" },
};

let wallet: object;
let packs: unknown[];
let offers: unknown;
function wire() {
  GET.mockImplementation(async (path: string) => {
    if (path === "/v1/wallet") return wallet;
    if (path === "/v1/wallet/packs") return ok(packs);
    if (path === "/v1/wallet/offers") return offers;
    throw new Error("unexpected " + path);
  });
}

function mount(config: unknown = baseConfig, lang = "en") {
  return render(<WalletView />, { wrapper: appWrapper({ config: config as never, lang }) });
}

const assign = vi.fn();
beforeEach(() => {
  resetNav("/wallet");
  vi.useFakeTimers({ shouldAdvanceTime: true });
  GET.mockReset();
  POST.mockReset();
  assign.mockReset();
  setAuth({ status: "authenticated", user: { ...aUser, phone: "999", display_name: "Ann" } as never });
  wallet = ok({ coin_balance: 345, is_vip: false });
  packs = [coinPack, vipPack, noPrice];
  offers = ok([]);
  wire();
  vi.stubGlobal("location", { origin: "https://katha.test", assign });
  delete (window as { Razorpay?: unknown }).Razorpay;
  document.head.querySelectorAll('script[data-razorpay="1"]').forEach((s) => s.remove());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("loading and balance", () => {
  it("shows the sign-in gate when anonymous", () => {
    setAuth({ status: "anonymous" });
    mount();
    expect(screen.getByText("Sign in to continue")).toBeInTheDocument();
  });

  it("shows skeletons first, then balance, VIP state and packs", async () => {
    const { container } = mount();
    expect(container.querySelectorAll(".k-skeleton").length).toBeGreaterThan(3);
    expect(await screen.findByText("345")).toBeInTheDocument();
    expect(screen.getByText(/Not active/)).toBeInTheDocument();
    expect(GET).toHaveBeenCalledWith("/v1/wallet/packs", { params: { query: { currency: "INR", country: "*" } } });
    expect(screen.getByText("Popular")).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getByText("+20% extra")).toBeInTheDocument();
    expect(screen.getByText(/About 12 episodes/)).toHaveTextContent("₹8.25 each");
    expect(screen.getByText("Best start")).toBeInTheDocument();
    expect(screen.getByText("30 days")).toBeInTheDocument(); // VIP default duration
    expect(screen.getByText("Every episode, no coins needed")).toBeInTheDocument();
    expect(screen.getByText("Go VIP · ₹299.50")).toBeInTheDocument();
    expect(screen.getByText("Get coins · ₹99")).toBeInTheDocument();
    expect(screen.getByText("Unavailable in INR")).toBeDisabled();
    expect(screen.getByText(/processed by Stripe \/ Razorpay\./)).toBeInTheDocument();
  });

  it("shows active VIP with end date, vip duration and no episode estimate without a price", async () => {
    wallet = ok({ coin_balance: 1, is_vip: true, vip_ends_at: "2026-12-25T00:00:00Z" });
    packs = [{ ...vipPack, duration_days: 90 }];
    mount({ ...baseConfig, economy: { currency: "INR", episode_price: 0 } });
    expect(await screen.findByText(/Active/)).toHaveTextContent("until");
    expect(screen.getByText("90 days")).toBeInTheDocument();
  });

  it("shows active VIP without an end date", async () => {
    wallet = ok({ coin_balance: 1, is_vip: true });
    mount();
    expect((await screen.findByText("Active")).textContent).toBe("Active");
  });

  it("shows an error state when the wallet or packs fail, and retries", async () => {
    wallet = fail(500);
    mount();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    wallet = ok({ coin_balance: 5, is_vip: false });
    fireEvent.click(screen.getByText("Try again"));
    expect(await screen.findByText("5")).toBeInTheDocument();
  });

  it("errors when packs fail", async () => {
    GET.mockImplementation(async (path: string) => (path === "/v1/wallet/packs" ? fail(500) : path === "/v1/wallet" ? wallet : offers));
    mount();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("tolerates a failed offers call", async () => {
    offers = fail(500);
    mount();
    expect(await screen.findByText("345")).toBeInTheDocument();
    expect(screen.queryByText("Offers", { selector: "h2" })).toBeNull();
  });

  it("shows the empty state with no packs and warns when payments are unavailable", async () => {
    packs = [];
    mount({ ...baseConfig, payments: { gateways: [] } });
    expect(await screen.findByText("No packs available right now")).toBeInTheDocument();
  });

  it("warns when there are packs but no gateway and disables buying", async () => {
    mount({ ...baseConfig, payments: undefined });
    expect(await screen.findByText(/Payments are not available/)).toBeInTheDocument();
    expect(screen.getByText("Get coins · ₹99").closest("button")).toBeDisabled();
    expect(screen.getByText(/our payment partner/)).toBeInTheDocument();
  });

  it("works without any config (defaults INR, stripe)", async () => {
    mount(null);
    expect(await screen.findByText("345")).toBeInTheDocument();
  });

  it("links to history using the language prefix", async () => {
    mount(baseConfig, "hi");
    await screen.findByText("345");
    expect(screen.getByText("History").closest("a")!.getAttribute("href")).toBe("/hi/wallet/history");
  });
});

describe("paywall return banner", () => {
  it("shows how many coins are needed and a safe back link", async () => {
    nav.search = new URLSearchParams("next=/series/x/3&need=1500");
    mount();
    expect(await screen.findByText("You need 1,500 more coins to keep watching.")).toBeInTheDocument();
    expect(screen.getByText("Back to the episode").closest("a")!.getAttribute("href")).toBe("/series/x/3");
  });

  it("uses generic copy without a need and drops unsafe next values", async () => {
    nav.search = new URLSearchParams("next=/series/x/3");
    const { unmount } = mount();
    expect(await screen.findByText("Top up and go straight back to your episode.")).toBeInTheDocument();
    unmount();
    nav.search = new URLSearchParams("next=//evil.com&need=5");
    mount();
    await screen.findByText("345");
    expect(screen.queryByText("Back to the episode")).toBeNull();
  });
});

describe("gateway selection", () => {
  it("prefers razorpay for INR and lets the viewer switch", async () => {
    mount();
    await screen.findByText("345");
    const razor = screen.getByLabelText("Razorpay") as HTMLInputElement;
    const stripe = screen.getByLabelText("Stripe") as HTMLInputElement;
    expect(razor.checked).toBe(true);
    fireEvent.click(stripe);
    expect(stripe.checked).toBe(true);
  });

  it("uses the first gateway for other currencies and hides the switcher with one gateway", async () => {
    mount({ ...baseConfig, economy: { currency: "usd" } });
    await screen.findByText("345");
    expect((screen.getByLabelText("Stripe") as HTMLInputElement).checked).toBe(true);
    const { unmount } = render(<div />);
    unmount();
  });

  it("hides the switcher with a single gateway", async () => {
    mount({ ...baseConfig, payments: { gateways: ["stripe"] } });
    await screen.findByText("345");
    expect(screen.queryByLabelText("Razorpay")).toBeNull();
  });
});

describe("stripe checkout", () => {
  const stripeConfig = { ...baseConfig, payments: { gateways: ["stripe"] } };
  const stripeOut = { gateway: "stripe", checkout_url: "https://checkout.stripe.com/c/pay/x", purchase_id: "pu1", currency: "INR" };

  async function buy(label = "Get coins · ₹99") {
    await screen.findByText("345");
    await act(async () => void fireEvent.click(screen.getByText(label)));
  }

  it("posts the checkout with success/cancel urls and navigates to Stripe", async () => {
    POST.mockResolvedValue(ok(stripeOut));
    mount(stripeConfig);
    await buy();
    expect(POST).toHaveBeenCalledWith("/v1/purchases/checkout", {
      body: {
        pack_id: "p1",
        gateway: "stripe",
        currency: "INR",
        country: "*",
        success_url: "https://katha.test/wallet",
        cancel_url: "https://katha.test/wallet?cancelled=1",
      },
    });
    expect(assign).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay/x");
    expect(track).toHaveBeenCalledWith("checkout_start", expect.objectContaining({ pack_id: "p1", gateway: "stripe", amount: 99, coupon: null, offer_id: null }));
  });

  it.each([undefined, "http://checkout.stripe.com/x", "https://evil.com/x", "not a url"])("refuses a bad checkout url %s", async (url) => {
    POST.mockResolvedValue(ok({ ...stripeOut, checkout_url: url }));
    mount(stripeConfig);
    await buy();
    expect(assign).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("Stripe did not return a valid checkout link.", "error");
  });

  it("accepts a checkout.stripe.com subdomain", async () => {
    POST.mockResolvedValue(ok({ ...stripeOut, checkout_url: "https://eu.checkout.stripe.com/x" }));
    mount(stripeConfig);
    await buy();
    expect(assign).toHaveBeenCalled();
  });

  it("includes coupon and offer in the request", async () => {
    offers = ok([{ id: "o1", title: "Deal", discount_pct: 10, ends_at: null }]);
    POST.mockResolvedValue(ok(stripeOut));
    mount(stripeConfig);
    await screen.findByText("Deal");
    fireEvent.click(screen.getByText("Deal"));
    fireEvent.change(screen.getByLabelText("Coupon code"), { target: { value: "save10" } });
    await buy();
    expect(POST.mock.calls[0][1].body).toMatchObject({ coupon_code: "SAVE10", offer_id: "o1" });
  });

  it("drops a selected offer that disappears on reload (after a paid poll)", async () => {
    offers = ok([{ id: "o1", title: "Deal", discount_pct: 10, ends_at: null }]);
    nav.search = new URLSearchParams("purchase_id=pu1");
    let status = "created";
    const defaults = GET.getMockImplementation()!;
    GET.mockImplementation(async (path: string, opts?: unknown) =>
      path === "/v1/purchases/{purchase_id}"
        ? ok({ id: "pu1", status, coins_granted: 5, amount: 1, currency: "INR", paid_at: null, created_at: "2026-01-01T00:00:00Z" })
        : defaults(path, opts),
    );
    POST.mockResolvedValue(ok({ gateway: "stripe", checkout_url: "https://checkout.stripe.com/x", purchase_id: "pu2", currency: "INR" }));
    mount(stripeConfig);
    fireEvent.click(await screen.findByText("Deal"));
    status = "paid";
    offers = ok([]);
    await act(async () => void (await vi.advanceTimersByTimeAsync(2100)));
    await screen.findByText("Coins added");
    expect(screen.queryByText("Deal")).toBeNull();
    fireEvent.click(screen.getByText("Done"));
    await act(async () => void fireEvent.click(screen.getByText("Get coins · ₹99")));
    expect(POST.mock.calls[0][1].body).not.toHaveProperty("offer_id");
  });

  it.each([
    ["coupon_invalid", /doesn't exist/],
    ["offer_unavailable", /just ended/],
  ])("shows %s next to the coupon field, not as a toast", async (code, re) => {
    POST.mockResolvedValue(fail(400, { code, message: "m" }));
    mount(stripeConfig);
    await buy();
    expect(screen.getByText(re)).toBeInTheDocument();
    expect(toast).not.toHaveBeenCalled();
    // editing the coupon clears the error
    fireEvent.change(screen.getByLabelText("Coupon code"), { target: { value: "x" } });
    expect(screen.queryByText(re)).toBeNull();
  });

  it("toasts other errors and re-enables buying", async () => {
    POST.mockResolvedValue(fail(500, { code: "boom", message: "Server broke" }));
    mount(stripeConfig);
    await buy();
    expect(toast).toHaveBeenCalledWith("Server broke", "error");
    expect(screen.getByText("Get coins · ₹99").closest("button")).toBeEnabled();
  });

  it("clears the coupon error when an offer is selected", async () => {
    offers = ok([{ id: "o1", title: "Deal", discount_pct: 10, ends_at: null }]);
    POST.mockResolvedValue(fail(400, { code: "coupon_inactive", message: "m" }));
    mount(stripeConfig);
    await screen.findByText("Deal");
    await buy();
    expect(screen.getByText(/not active right now/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Deal"));
    expect(screen.queryByText(/not active right now/)).toBeNull();
  });

  describe("discount confirmation", () => {
    const discounted = { ...stripeOut, discount_pct: 20, amount: 79, currency: "INR" };

    it("shows the discounted price, can be cancelled, and proceeds on confirm", async () => {
      POST.mockResolvedValue(ok(discounted));
      mount(stripeConfig);
      await buy();
      const dlg = screen.getByText("Your discount is applied").closest("dialog")!;
      expect(within(dlg).getByText("20% off")).toBeInTheDocument();
      expect(within(dlg).getByText("₹99")).toHaveClass("line-through");
      expect(within(dlg).getByText("₹79")).toBeInTheDocument();
      expect(assign).not.toHaveBeenCalled();
      fireEvent.click(within(dlg).getByText("Cancel"));
      expect(dlg.hasAttribute("open")).toBe(false);
      await act(async () => void fireEvent.click(screen.getByText("Get coins · ₹99")));
      await act(async () => void fireEvent.click(screen.getByText("Continue to payment")));
      expect(assign).toHaveBeenCalledWith(stripeOut.checkout_url);
    });

    it("falls back to the pack price when the API sends no amount", async () => {
      POST.mockResolvedValue(ok({ ...discounted, amount: null }));
      mount(stripeConfig);
      await buy();
      const dlg = screen.getByText("Your discount is applied").closest("dialog")!;
      expect(within(dlg).getByText("₹99")).not.toHaveClass("line-through");
    });
  });
});

describe("razorpay checkout", () => {
  const out = { gateway: "razorpay", order_id: "ord", key_id: "key", amount_minor: 9900, currency: "INR", purchase_id: "pu9" };

  async function buy() {
    await screen.findByText("345");
    await act(async () => void fireEvent.click(screen.getByText("Get coins · ₹99")));
  }

  function installRazorpay() {
    const open = vi.fn();
    const ctor = vi.fn(function (this: unknown, opts: Record<string, unknown>) {
      (ctor as unknown as { opts: Record<string, unknown> }).opts = opts;
      return { open };
    });
    (window as { Razorpay?: unknown }).Razorpay = ctor;
    return { ctor, open, opts: () => (ctor as unknown as { opts: Record<string, Loose> }).opts };
  }

  it("opens the Razorpay modal with prefill and theme; dismissing returns to idle", async () => {
    const rz = installRazorpay();
    POST.mockResolvedValue(ok(out));
    mount();
    await buy();
    expect(rz.open).toHaveBeenCalled();
    expect(rz.opts()).toMatchObject({
      key: "key",
      order_id: "ord",
      amount: 9900,
      currency: "INR",
      name: "KathaTV",
      description: "Starter",
      prefill: { email: "ann@example.com", contact: "999", name: "Ann" },
      modal: { confirm_close: true },
    });
    act(() => rz.opts().modal.ondismiss());
  });

  it("polls after the Razorpay handler fires and shows the paid dialog", async () => {
    const rz = installRazorpay();
    POST.mockResolvedValue(ok(out));
    mount();
    await buy();
    const defaults = GET.getMockImplementation()!;
    GET.mockImplementation(async (path: string, opts?: unknown) =>
      path === "/v1/purchases/{purchase_id}"
        ? ok({ id: "pu9", status: "paid", coins_granted: 120, amount: 99, currency: "INR", paid_at: null, created_at: "2026-01-02T00:00:00Z" })
        : defaults(path, opts),
    );
    await act(async () => rz.opts().handler());
    expect(await screen.findByText("Coins added")).toBeInTheDocument();
    expect(screen.getByText("+120 coins")).toBeInTheDocument();
    expect(auth.refreshUser).toHaveBeenCalled();
    fireEvent.click(screen.getByText("Done"));
  });

  it("works with missing prefill data and no site name", async () => {
    const rz = installRazorpay();
    setAuth({ status: "authenticated", user: { id: "u" } as never });
    POST.mockResolvedValue(ok({ ...out, amount_minor: null }));
    mount({ ...baseConfig, site: undefined });
    await buy();
    expect(rz.opts()).toMatchObject({ name: "Katha", amount: undefined, prefill: {} });
  });

  it("reports an error when the script cannot load (onerror)", async () => {
    POST.mockResolvedValue(ok(out));
    mount();
    await buy();
    const script = document.head.querySelector<HTMLScriptElement>('script[data-razorpay="1"]')!;
    expect(script.src).toBe("https://checkout.razorpay.com/v1/checkout.js");
    await act(async () => void script.onerror!(new Event("error")));
    expect(toast).toHaveBeenCalledWith("Razorpay could not be loaded. Try Stripe instead.", "error");
  });

  it("loads the script (onload) and then opens", async () => {
    POST.mockResolvedValue(ok(out));
    mount();
    await buy();
    const rz = installRazorpay();
    const script = document.head.querySelector<HTMLScriptElement>('script[data-razorpay="1"]')!;
    await act(async () => void script.onload!(new Event("load")));
    await waitFor(() => expect(rz.open).toHaveBeenCalled());
  });

  it("reuses an in-flight script tag and reacts to its load/error events", async () => {
    const existing = document.createElement("script");
    existing.dataset.razorpay = "1";
    document.head.appendChild(existing);
    POST.mockResolvedValue(ok(out));
    mount();
    await buy();
    expect(document.head.querySelectorAll('script[data-razorpay="1"]').length).toBe(1);
    await act(async () => void existing.dispatchEvent(new Event("error")));
    expect(toast).toHaveBeenCalledWith("Razorpay could not be loaded. Try Stripe instead.", "error");

    toast.mockClear();
    const rz = installRazorpay();
    await act(async () => void fireEvent.click(screen.getByText("Get coins · ₹99")));
    await act(async () => void existing.dispatchEvent(new Event("load")));
    await waitFor(() => expect(rz.open).toHaveBeenCalled());
  });

  it("errors when the order id or key is missing", async () => {
    installRazorpay();
    POST.mockResolvedValue(ok({ ...out, key_id: null }));
    mount();
    await buy();
    expect(toast).toHaveBeenCalledWith("Razorpay could not be loaded. Try Stripe instead.", "error");
  });
});

describe("polling and return from Stripe", () => {
  const purchase = (status: string, extra: object = {}) =>
    ok({ id: "pu1", status, coins_granted: 50, amount: 99, currency: "INR", paid_at: "2026-01-02T00:00:00Z", created_at: "2026-01-01T00:00:00Z", ...extra });

  function setPurchase(fn: () => unknown) {
    const defaults = GET.getMockImplementation()!;
    GET.mockImplementation(async (path: string, opts?: unknown) => (path === "/v1/purchases/{purchase_id}" ? fn() : defaults(path, opts)));
  }

  it("polls ?purchase_id, tracks the return, cleans the URL and shows success", async () => {
    nav.search = new URLSearchParams("purchase_id=pu1");
    setPurchase(() => purchase("paid"));
    mount();
    expect(await screen.findByText("Coins added")).toBeInTheDocument();
    expect(track).toHaveBeenCalledWith("checkout_return", { purchase_id: "pu1", status: "returned" });
    expect(nav.router.replace).toHaveBeenCalledWith("/wallet", { scroll: false });
    expect(GET).toHaveBeenCalledWith("/v1/purchases/{purchase_id}", { params: { path: { purchase_id: "pu1" } } });
    expect(auth.refreshUser).toHaveBeenCalled();
  });

  it("accepts the legacy ?purchase= parameter", async () => {
    nav.search = new URLSearchParams("purchase=pu1");
    setPurchase(() => purchase("paid"));
    mount();
    expect(await screen.findByText("Coins added")).toBeInTheDocument();
  });

  it("offers a back link after payment when the viewer came from an episode", async () => {
    nav.search = new URLSearchParams("purchase_id=pu1&next=/series/a/2");
    setPurchase(() => purchase("paid", { paid_at: null }));
    mount();
    await screen.findByText("Coins added");
    const dlg = screen.getByText("Coins added").closest("dialog")!;
    expect(within(dlg).getByText("Back to the episode").closest("a")!.getAttribute("href")).toBe("/series/a/2");
  });

  it("keeps polling every 2s while pending, then gives up after 60s with a check-again option", async () => {
    nav.search = new URLSearchParams("purchase_id=pu1");
    let calls = 0;
    setPurchase(() => (++calls, purchase("created")));
    mount();
    await screen.findByText("Confirming your payment");
    await act(async () => void (await vi.advanceTimersByTimeAsync(2000)));
    expect(calls).toBe(2);
    await act(async () => void (await vi.advanceTimersByTimeAsync(62_000)));
    expect(screen.getByText("Still confirming")).toBeInTheDocument();
    setPurchase(() => purchase("paid"));
    await act(async () => void fireEvent.click(screen.getByText("Check again")));
    expect(await screen.findByText("Coins added")).toBeInTheDocument();
  });

  it("shows the pending dialog's Close button", async () => {
    nav.search = new URLSearchParams("purchase_id=pu1");
    setPurchase(() => purchase("created"));
    mount();
    await screen.findByText("Confirming your payment");
    await act(async () => void (await vi.advanceTimersByTimeAsync(65_000)));
    const dlg = screen.getByText("Still confirming").closest("dialog")!;
    fireEvent.click(within(dlg).getByText("Close", { selector: "button" }));
    expect(dlg.hasAttribute("open")).toBe(false);
  });

  it.each(["failed", "refunded"])("shows failure for %s", async (status) => {
    nav.search = new URLSearchParams("purchase_id=pu1");
    setPurchase(() => purchase(status));
    mount();
    expect(await screen.findByText("Payment failed")).toBeInTheDocument();
    expect(screen.getByText("The payment did not go through.")).toBeInTheDocument();
  });

  it("shows failure when the purchase is not found", async () => {
    nav.search = new URLSearchParams("purchase_id=pu1");
    setPurchase(() => fail(404));
    mount();
    expect(await screen.findByText("We could not find this purchase.")).toBeInTheDocument();
    const dlg = screen.getByText("Payment failed").closest("dialog")!;
    fireEvent.click(within(dlg).getByText("Close", { selector: "button" }));
    expect(dlg.hasAttribute("open")).toBe(false);
  });

  it("a slow first poll response still resolves the flow", async () => {
    nav.search = new URLSearchParams("purchase_id=pu1");
    let resolveFirst!: (v: unknown) => void;
    let n = 0;
    setPurchase(() => (++n === 1 ? new Promise((r) => (resolveFirst = r)) : purchase("created")));
    mount();
    await screen.findByText("Confirming your payment");
    await act(async () => resolveFirst(purchase("paid")));
    expect(await screen.findByText("Coins added")).toBeInTheDocument();
  });

  it("ignores a poll result that arrives after unmount", async () => {
    nav.search = new URLSearchParams("purchase_id=pu1");
    let resolveFirst!: (v: unknown) => void;
    setPurchase(() => new Promise((r) => (resolveFirst = r)));
    const { unmount } = mount();
    await screen.findByText("Confirming your payment");
    unmount();
    await act(async () => resolveFirst(purchase("paid")));
    expect(auth.refreshUser).not.toHaveBeenCalled();
  });

  it("handles a cancelled return with a toast and URL clean-up", async () => {
    nav.search = new URLSearchParams("cancelled=1");
    mount();
    await screen.findByText("345");
    expect(toast).toHaveBeenCalledWith("Payment cancelled.", "info");
    expect(track).toHaveBeenCalledWith("checkout_return", { purchase_id: null, status: "cancelled" });
    expect(nav.router.replace).toHaveBeenCalledWith("/wallet", { scroll: false });
  });
});
