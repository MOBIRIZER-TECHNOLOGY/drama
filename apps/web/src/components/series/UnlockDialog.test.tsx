import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithApp } from "@/test-utils/app";
import { ep } from "@/test-utils/series-fixtures";
import { UnlockDialog, type BundleQuote, type UnlockStatus } from "./UnlockDialog";

beforeEach(() => {
  vi.useFakeTimers();
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});
afterEach(() => vi.useRealTimers());

const bundle: BundleQuote = { episode_count: 8, list_price: 200, price: 150, discount_pct: 25, saving: 50, affordable: true };

function setup(over: Partial<React.ComponentProps<typeof UnlockDialog>> = {}, config: unknown = null) {
  const props = {
    episode: ep(3, { price: 30, title: "Cliffhanger", thumbnail_url: "https://cdn/x.jpg" }),
    balance: 100,
    status: { kind: "idle" } as UnlockStatus,
    bundle: null,
    episodeCount: 10,
    seriesSlug: "my-show",
    onClose: vi.fn(),
    onUnlock: vi.fn(),
    onUnlockBundle: vi.fn(),
    ...over,
  };
  const r = renderWithApp(<UnlockDialog {...props} />, { config: config as never });
  return { ...r, props };
}

describe("UnlockDialog", () => {
  it("renders nothing inside the dialog without an episode", () => {
    setup({ episode: null });
    expect(screen.queryByText("Unlock for 30 coins")).toBeNull();
  });

  it("shows the episode, position and the coin CTA with the balance after", () => {
    setup();
    expect(screen.getByText("Cliffhanger")).toBeInTheDocument();
    expect(screen.getByText("Episode 3 of 10")).toBeInTheDocument();
    expect(screen.getByText("Unlock for 30 coins")).toBeInTheDocument();
    expect(screen.getByText("Balance 100 → 70")).toBeInTheDocument();
    expect(screen.getByText("Unlock episode 3")).toBeInTheDocument();
  });

  it("omits title and position when absent", () => {
    setup({ episode: ep(3, { title: null }), episodeCount: 0 });
    expect(screen.queryByText(/Episode 3 of/)).toBeNull();
  });

  it("ignores clicks on paid controls until the sheet has settled (250ms)", () => {
    const { props } = setup();
    const cta = screen.getByText("Unlock for 30 coins").closest("button")!;
    expect(cta.className).toContain("pointer-events-none");
    act(() => void vi.advanceTimersByTime(250));
    expect(cta.className).not.toContain("pointer-events-none");
    fireEvent.click(cta);
    expect(props.onUnlock).toHaveBeenCalledWith("coins");
  });

  it("re-arms the guard when the episode changes to null and back", () => {
    const { rerender, props } = setup();
    act(() => void vi.advanceTimersByTime(250));
    rerender(<UnlockDialog {...props} episode={null} />);
    act(() => void vi.advanceTimersByTime(1));
    rerender(<UnlockDialog {...props} />);
    expect(screen.getByText("Unlock for 30 coins").closest("button")!.className).toContain("pointer-events-none");
  });

  it("when the balance is short it offers top-up with a return path and the shortfall", () => {
    const { props } = setup({ balance: 10 });
    expect(screen.getByText("You need 20 more coins.")).toBeInTheDocument();
    const link = screen.getByText("Get coins").closest("a")!;
    expect(link.getAttribute("href")).toBe(`/wallet?next=${encodeURIComponent("/series/my-show?ep=3")}&need=20`);
    fireEvent.click(link);
    expect(props.onClose).toHaveBeenCalled();
  });

  it("an 'insufficient' status shows its message and the top-up even with enough balance", () => {
    setup({ status: { kind: "insufficient", message: "Server says no" } });
    expect(screen.getByText("Server says no")).toBeInTheDocument();
    expect(screen.getByText("Get coins")).toBeInTheDocument();
  });

  it("sequential and error statuses show an alert", () => {
    const { unmount } = setup({ status: { kind: "sequential", message: "Unlock 2 first" } });
    expect(screen.getByRole("alert").textContent).toBe("Unlock 2 first");
    unmount();
    setup({ status: { kind: "error", message: "Boom" } });
    expect(screen.getByRole("alert").textContent).toBe("Boom");
  });

  it("busy disables both buttons", () => {
    setup({ status: { kind: "busy" }, bundle }, { flags: { rewarded_ads: true } });
    expect(screen.getByText("Unlock for 30 coins").closest("button")).toBeDisabled();
    expect(screen.getByText("Unlock the whole series").closest("button")).toBeDisabled();
    expect(screen.getByText("Watch an ad to unlock").closest("button")).toBeDisabled();
  });

  it("bundle-busy marks the bundle button busy", () => {
    setup({ status: { kind: "bundle-busy" }, bundle });
    expect(screen.getByText("Unlock the whole series").closest("button")!.getAttribute("aria-busy")).toBe("true");
  });

  it("affordable bundle shows discount and unlocks", () => {
    const { props } = setup({ bundle });
    expect(screen.getByText("Unlock all 8 remaining episodes")).toBeInTheDocument();
    expect(screen.getByText("Save 25%")).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(250));
    fireEvent.click(screen.getByText("Unlock the whole series"));
    expect(props.onUnlockBundle).toHaveBeenCalled();
  });

  it("unaffordable bundle links to the wallet; no discount badge at 0%; single-episode bundle is hidden", () => {
    const { props, unmount } = setup({ bundle: { ...bundle, affordable: false, discount_pct: 0 } });
    expect(screen.queryByText(/Save/)).toBeNull();
    const link = screen.getByText("Get 150 coins for the bundle").closest("a")!;
    expect(link.getAttribute("href")).toBe(`/wallet?next=${encodeURIComponent("/series/my-show?ep=3")}&need=150`);
    fireEvent.click(link);
    expect(props.onClose).toHaveBeenCalled();
    unmount();
    setup({ bundle: { ...bundle, episode_count: 1 } });
    expect(screen.queryByText(/remaining episodes/)).toBeNull();
  });

  it("offers a rewarded ad only when the flag is on", () => {
    const { props, unmount } = setup();
    expect(screen.queryByText("Watch an ad to unlock")).toBeNull();
    unmount();
    const r = setup({}, { flags: { rewarded_ads: true } });
    fireEvent.click(screen.getByText("Watch an ad to unlock"));
    expect(r.props.onUnlock).toHaveBeenCalledWith("ad");
    expect(props.onUnlock).not.toHaveBeenCalled();
  });

  it("VIP link closes the sheet", () => {
    const { props } = setup();
    const link = screen.getByText("Or go VIP and watch everything").closest("a")!;
    expect(link.getAttribute("href")).toBe("/wallet");
    fireEvent.click(link);
    expect(props.onClose).toHaveBeenCalled();
  });
});
