import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appWrapper } from "@/test-utils/app";
import { Countdown, OffersPanel, useOfferErrorMessage } from "./OffersPanel";

const NOW = new Date("2026-06-01T00:00:00Z").getTime();
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

const iso = (ms: number) => new Date(NOW + ms).toISOString();
const wrapper = appWrapper();

describe("useOfferErrorMessage", () => {
  it("maps each code and falls back otherwise", () => {
    const { result } = renderHook(() => useOfferErrorMessage(), { wrapper });
    const m = result.current;
    expect(m("coupon_invalid", "fb")).toMatch(/doesn't exist/);
    expect(m("coupon_exhausted", "fb")).toMatch(/fully redeemed/);
    expect(m("coupon_inactive", "fb")).toMatch(/not active/);
    expect(m("coupon_region", "fb")).toMatch(/region/);
    expect(m("coupon_first_purchase", "fb")).toMatch(/first purchase/);
    expect(m("offer_unavailable", "fb")).toMatch(/just ended/);
    expect(m("other", "fb")).toBe("fb");
  });
});

describe("Countdown", () => {
  const show = (ms: number) => render(<Countdown to={iso(ms)} />, { wrapper });

  it("formats days+hours, hours+minutes, minutes+seconds and seconds", () => {
    expect(show(2 * 86_400_000 + 3 * 3_600_000).container).toHaveTextContent("Ends in 2d 3h");
    expect(show(3_600_000 * 5 + 60_000 * 7).container).toHaveTextContent("Ends in 5h 7m");
    expect(show(60_000 * 4 + 9000).container).toHaveTextContent("Ends in 4m 9s");
    expect(show(30_000).container).toHaveTextContent("Ends in 30s");
  });

  it("ticks every second and flips to Ended", () => {
    const { container } = show(2000);
    expect(container).toHaveTextContent("Ends in 2s");
    act(() => void vi.advanceTimersByTime(1000));
    expect(container).toHaveTextContent("Ends in 1s");
    act(() => void vi.advanceTimersByTime(1000));
    expect(container).toHaveTextContent("Ended");
    expect(vi.getTimerCount()).toBe(1); // interval is cleared only on unmount/target change
  });

  it("is Ended immediately for a past date and starts no timer", () => {
    const { container } = show(-1000);
    expect(container).toHaveTextContent("Ended");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("renders nothing for an invalid date and clears its interval on unmount", () => {
    const bad = render(<Countdown to="nonsense" />, { wrapper });
    expect(bad.container.innerHTML).toBe("");
    const { unmount } = show(60_000);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

const offers = [
  { id: "o1", title: "Diwali", discount_pct: 20, ends_at: iso(3_600_000) },
  { id: "o2", title: "Weekend", discount_pct: 0, ends_at: null },
] as never;

function panel(props: Partial<React.ComponentProps<typeof OffersPanel>> = {}) {
  const p = {
    offers,
    selectedOfferId: null,
    onSelectOffer: vi.fn(),
    coupon: "",
    onCouponChange: vi.fn(),
    couponError: null,
    busy: false,
    ...props,
  };
  render(<OffersPanel {...p} />, { wrapper });
  return p;
}

describe("OffersPanel", () => {
  it("lists offers with discount, countdown or 'Limited time'", () => {
    panel();
    expect(screen.getByText("Diwali")).toBeInTheDocument();
    expect(screen.getByText("20% off")).toBeInTheDocument();
    expect(screen.getByText(/Ends in 1h 0m/)).toBeInTheDocument();
    expect(screen.getByText("Limited time")).toBeInTheDocument();
    expect(screen.queryByText("0% off")).toBeNull();
  });

  it("selects and toggles an offer off", () => {
    const p = panel({ selectedOfferId: "o1" });
    const btn = screen.getByText("Diwali").closest("button")!;
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(btn);
    expect(p.onSelectOffer).toHaveBeenCalledWith(null);
    fireEvent.click(screen.getByText("Weekend"));
    expect(p.onSelectOffer).toHaveBeenCalledWith("o2");
  });

  it("hides the offers list when there are none but keeps the coupon field", () => {
    panel({ offers: null });
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByLabelText("Coupon code")).toBeInTheDocument();
  });

  it("normalises coupon input (upper-case, no spaces, 32 chars)", () => {
    const p = panel({ offers: [] });
    fireEvent.change(screen.getByLabelText("Coupon code"), { target: { value: "ka tha10" + "x".repeat(40) } });
    expect(p.onCouponChange).toHaveBeenCalledWith(("KATHA10" + "X".repeat(40)).slice(0, 32));
  });

  it("shows Clear when a code is entered, an error, and disables while busy", () => {
    const p = panel({ coupon: "ABC", couponError: "Bad code", busy: true });
    expect(screen.getByText("Bad code")).toBeInTheDocument();
    expect(screen.getByLabelText("Coupon code")).toBeDisabled();
    expect(screen.getByText("Clear")).toBeDisabled();
    expect(p.onCouponChange).not.toHaveBeenCalled();
  });

  it("Clear empties the code", () => {
    const p = panel({ coupon: "ABC" });
    fireEvent.click(screen.getByText("Clear"));
    expect(p.onCouponChange).toHaveBeenCalledWith("");
  });
});
