import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appWrapper } from "@/test-utils/app";
import { aUser, setAuth } from "@/test-utils/auth-context";
import { ReferralCard } from "./ReferralCard";

vi.mock("@/lib/auth-context", () => import("@/test-utils/auth-context"));
const track = vi.fn();
vi.mock("@/lib/analytics", () => ({ track: (...a: unknown[]) => track(...a) }));
const toast = vi.fn();
vi.mock("@/lib/toast", () => ({ useToast: () => toast }));

const config = { referral: { enabled: true, referrer_coins: 50, referee_coins: 30 } } as never;
const withCode = { ...aUser, referral_code: "ABCD1234" } as never;

function renderCard(cfg: unknown = config) {
  return render(<ReferralCard />, { wrapper: appWrapper({ config: cfg as never }) });
}

beforeEach(() => {
  setAuth({ status: "authenticated", user: withCode });
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
});

describe("ReferralCard", () => {
  it("renders nothing without a referral code or when disabled", () => {
    setAuth({ status: "authenticated", user: aUser });
    const { container } = renderCard();
    expect(container.innerHTML).toBe("");
    setAuth({ status: "authenticated", user: withCode });
    const { container: c2 } = renderCard({ referral: { enabled: false } });
    expect(c2.innerHTML).toBe("");
  });

  it("shows the reward copy and the code", () => {
    renderCard();
    expect(screen.getByText("Invite a friend — you both get 50 coins")).toBeInTheDocument();
    expect(screen.getByText(/They get 30 coins/)).toHaveTextContent("You get 50 coins");
    expect(screen.getByText("ABCD1234")).toBeInTheDocument();
  });

  it("uses the plain title when there is no referee reward, and referee coins as the amount when referrer is zero", () => {
    renderCard({ referral: { enabled: true, referrer_coins: 0, referee_coins: 0 } });
    expect(screen.getByText("Invite a friend")).toBeInTheDocument();
  });

  it("falls back to referee coins in the title", () => {
    renderCard({ referral: { enabled: true, referrer_coins: 0, referee_coins: 25 } });
    expect(screen.getByText("Invite a friend — you both get 25 coins")).toBeInTheDocument();
  });

  it("defaults to zero rewards without referral config", () => {
    renderCard(null);
    expect(screen.getByText("Invite a friend")).toBeInTheDocument();
  });

  it("copies the invite link, toasts, tracks and flips the label back", async () => {
    vi.useFakeTimers();
    renderCard();
    await act(async () => {
      fireEvent.click(screen.getByText("Copy link"));
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("http://localhost:3000/?ref=ABCD1234");
    expect(toast).toHaveBeenCalledWith("Invite link copied", "success");
    expect(track).toHaveBeenCalledWith("referral_share", { method: "copy" });
    expect(screen.getByText("Copied")).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(2000));
    expect(screen.getByText("Copy link")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("toasts an error when copying fails", async () => {
    (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("no"));
    renderCard();
    fireEvent.click(screen.getByText("Copy link"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Could not copy the link", "error"));
    expect(track).not.toHaveBeenCalledWith("referral_share", { method: "copy" });
  });

  it("uses the native share sheet when available", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    renderCard();
    fireEvent.click(screen.getByText("Share invite"));
    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(share.mock.calls[0][0]).toMatchObject({ title: "Katha", url: "http://localhost:3000/?ref=ABCD1234" });
    expect(track).toHaveBeenCalledWith("referral_share", { method: "share" });
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it("falls back to copying when sharing is dismissed or unsupported", async () => {
    const share = vi.fn().mockRejectedValue(new Error("AbortError"));
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    renderCard();
    fireEvent.click(screen.getByText("Share invite"));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1));
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    fireEvent.click(screen.getByText("Share invite"));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(2));
  });

  it("links to WhatsApp with the encoded message and tracks the click", () => {
    renderCard();
    const a = screen.getByText("Send on WhatsApp") as HTMLAnchorElement;
    expect(a.href).toContain("https://wa.me/?text=");
    expect(decodeURIComponent(a.href)).toContain("http://localhost:3000/?ref=ABCD1234");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    fireEvent.click(a);
    expect(track).toHaveBeenCalledWith("referral_share", { method: "whatsapp" });
  });
});
