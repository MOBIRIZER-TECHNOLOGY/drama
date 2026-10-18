import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appWrapper } from "@/test-utils/app";
import { aUser, auth, setAuth } from "@/test-utils/auth-context";
import { RewardsView } from "./RewardsView";

vi.mock("next/navigation", () => import("@/test-utils/next-navigation"));
vi.mock("@/lib/auth-context", () => import("@/test-utils/auth-context"));
const GET = vi.fn();
const POST = vi.fn();
vi.mock("@/lib/client-api", () => ({ clientApi: { GET: (...a: unknown[]) => GET(...a), POST: (...a: unknown[]) => POST(...a) } }));
const toast = vi.fn();
vi.mock("@/lib/toast", () => ({ useToast: () => toast }));
vi.mock("../ReferralCard", () => ({ ReferralCard: () => <div data-testid="referral" /> }));

const ok = (data: unknown) => ({ data, response: { ok: true, status: 200 } });
const fail = (status = 500, message = "bad") => ({ error: { detail: { code: "e", message } }, response: { ok: false, status } });

const ladder = [5, 10, 15, 20, 25, 30, 100];
let checkin: Record<string, unknown>;
let tasks: Record<string, unknown>[];
const task = (over: Record<string, unknown> = {}) => ({
  id: "t1",
  kind: "visit",
  title: "Follow us",
  description: "Do it",
  coins: 7,
  url: null,
  timer_seconds: 0,
  frequency: "daily",
  claimed: false,
  ...over,
});

function wire() {
  GET.mockImplementation(async (path: string) => (path === "/v1/rewards/checkin" ? ok(checkin) : ok(tasks)));
}
const mount = (config: unknown = null) => render(<RewardsView />, { wrapper: appWrapper({ config: config as never }) });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  GET.mockReset();
  POST.mockReset();
  setAuth({ status: "authenticated", user: aUser });
  checkin = { checked_in_today: false, streak_day: 0, next_streak_day: 1, rewards: ladder, coin_balance: 10 };
  tasks = [task()];
  wire();
});
afterEach(() => vi.useRealTimers());

describe("check-in strip", () => {
  it("requires sign-in", () => {
    setAuth({ status: "anonymous" });
    mount();
    expect(screen.getByText("Sign in to continue")).toBeInTheDocument();
  });

  it("shows skeletons then the starting copy and jackpot hint", async () => {
    const { container } = mount();
    expect(container.querySelectorAll(".k-skeleton").length).toBeGreaterThan(5);
    expect(await screen.findByText("Check in to start a streak. Day 7 pays the most.")).toBeInTheDocument();
    expect(screen.getByText("6 more days to 100 coins.")).toBeInTheDocument();
    const steps = screen.getAllByRole("listitem").filter((li) => li.getAttribute("aria-current") === "step");
    expect(steps).toHaveLength(1);
    expect(steps[0]).toHaveTextContent("1");
    expect(screen.getByTestId("referral")).toBeInTheDocument();
  });

  it("warns that a streak is at risk and marks completed days", async () => {
    checkin = { ...checkin, streak_day: 3, next_streak_day: 4 };
    mount();
    expect(await screen.findByText("Check in today or your 3-day streak resets.")).toBeInTheDocument();
    const items = screen.getAllByRole("listitem").slice(0, 7);
    expect(items.filter((li) => li.querySelector("svg.text-success")).length).toBe(3);
    expect(items[3].getAttribute("aria-current")).toBe("step");
  });

  it("shows the checked-in state with tomorrow's day (capped at the cycle) and a disabled button", async () => {
    checkin = { ...checkin, checked_in_today: true, streak_day: 7, next_streak_day: 1 };
    mount();
    expect(await screen.findByText("Checked in today. Come back tomorrow for day 7.")).toBeInTheDocument();
    expect(screen.getByText("Claimed", { selector: "button" })).toBeDisabled();
    expect(screen.queryByText(/more days to/)).toBeNull();
  });

  it("hides the jackpot hint on the last day", async () => {
    checkin = { ...checkin, streak_day: 6, next_streak_day: 7 };
    mount();
    await screen.findByText(/streak resets/);
    expect(screen.queryByText(/more days to/)).toBeNull();
  });

  it("claims, updates balance and streak, and toasts gold", async () => {
    POST.mockResolvedValue(ok({ coins: 5, streak_day: 1, coin_balance: 15 }));
    mount();
    await screen.findByText("Daily check-in");
    const claim = (await screen.findAllByText("Claim", { selector: "button" }))[0];
    await act(async () => void fireEvent.click(claim));
    expect(POST).toHaveBeenCalledWith("/v1/rewards/checkin");
    expect(auth.setBalance).toHaveBeenCalledWith(15);
    expect(toast).toHaveBeenCalledWith("+5 coins — day 1 streak!", "gold");
    expect(screen.getByText("Claimed", { selector: "button" })).toBeDisabled();
    expect(screen.getByText(/Checked in today/)).toBeInTheDocument();
  });

  it("toasts the API message when claiming fails", async () => {
    POST.mockResolvedValue(fail(409, "Already claimed"));
    mount();
    await screen.findByText("Daily check-in");
    const claim = (await screen.findAllByText("Claim", { selector: "button" }))[0];
    await act(async () => void fireEvent.click(claim));
    expect(toast).toHaveBeenCalledWith("Already claimed", "error");
    expect(auth.setBalance).not.toHaveBeenCalled();
  });

  it.each([
    ["check-in", () => GET.mockImplementation(async (p: string) => (p === "/v1/rewards/checkin" ? fail() : ok(tasks)))],
    ["tasks", () => GET.mockImplementation(async (p: string) => (p === "/v1/rewards/checkin" ? ok(checkin) : fail()))],
  ])("shows an error state when %s fails, and retries", async (_n, arrange) => {
    arrange();
    mount();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    wire();
    await act(async () => void fireEvent.click(screen.getByText("Try again")));
    expect(await screen.findByText("Daily check-in")).toBeInTheDocument();
  });
});

describe("tasks", () => {
  it("shows the empty state", async () => {
    tasks = [];
    mount();
    expect(await screen.findByText("No tasks right now")).toBeInTheDocument();
  });

  it("hides rewarded-ad tasks unless the flag is on", async () => {
    tasks = [task({ id: "a", kind: "rewarded_ad", title: "Watch ad" }), task({ id: "b", title: "Plain" })];
    const { unmount } = mount();
    await screen.findByText("Plain");
    expect(screen.queryByText("Watch ad")).toBeNull();
    unmount();
    mount({ flags: { rewarded_ads: true } });
    expect(await screen.findByText("Watch ad")).toBeInTheDocument();
  });

  it("an instant task shows Claim, claims it, marks it claimed and updates the balance", async () => {
    POST.mockResolvedValue(ok({ coins: 7, coin_balance: 99 }));
    mount();
    expect(await screen.findByText("Follow us")).toBeInTheDocument();
    expect(screen.getByText("Daily")).toBeInTheDocument();
    expect(screen.getByText("+7")).toBeInTheDocument();
    const row = screen.getByText("Follow us").closest("li")!;
    await act(async () => void fireEvent.click(within(row).getByText("Claim")));
    expect(POST).toHaveBeenCalledWith("/v1/rewards/tasks/{task_id}/claim", { params: { path: { task_id: "t1" } }, body: {} });
    expect(auth.setBalance).toHaveBeenCalledWith(99);
    expect(toast).toHaveBeenCalledWith("+7 coins", "gold");
    expect(within(row).getByText("Claimed")).toBeInTheDocument();
    expect(row.className).toContain("opacity-60");
  });

  it("a failed claim returns to Claim and toasts the error", async () => {
    POST.mockResolvedValue(fail(500, "Nope"));
    tasks = [task({ frequency: "once", description: null })];
    mount();
    const row = (await screen.findByText("Follow us")).closest("li")!;
    expect(within(row).getByText("One time")).toBeInTheDocument();
    await act(async () => void fireEvent.click(within(row).getByText("Claim")));
    expect(toast).toHaveBeenCalledWith("Nope", "error");
    expect(within(row).getByText("Claim")).toBeEnabled();
  });

  it("renders already-claimed tasks as claimed", async () => {
    tasks = [task({ claimed: true })];
    mount();
    expect(await screen.findByText("Claimed", { selector: "span" })).toBeInTheDocument();
  });

  it("a link+timer task opens the link, counts down, then becomes claimable", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    tasks = [task({ url: "https://example.com", timer_seconds: 3 })];
    mount();
    const row = (await screen.findByText("Follow us")).closest("li")!;
    expect(within(row).getByText(/Stay for 3s/)).toBeInTheDocument();
    fireEvent.click(within(row).getByText("Open"));
    expect(open).toHaveBeenCalledWith("https://example.com", "_blank", "noopener,noreferrer");
    expect(within(row).getByText("3s")).toBeDisabled();
    act(() => void vi.advanceTimersByTime(1100));
    expect(within(row).getByText("2s")).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(2500));
    expect(within(row).getByText("Claim")).toBeEnabled();
  });

  it("a link task without a timer becomes claimable straight away", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    tasks = [task({ url: "https://example.com", timer_seconds: 0 })];
    mount();
    // timer_seconds 0 => the initial phase is already "ready"
    const row = (await screen.findByText("Follow us")).closest("li")!;
    expect(within(row).getByText("Claim")).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
  });

  it("clears the countdown interval on unmount", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    tasks = [task({ url: "https://example.com", timer_seconds: 30 })];
    const { unmount } = mount();
    fireEvent.click(within((await screen.findByText("Follow us")).closest("li")!).getByText("Open"));
    const before = vi.getTimerCount();
    unmount();
    expect(vi.getTimerCount()).toBeLessThan(before);
  });

  it("a timer task without a url needs no waiting", async () => {
    tasks = [task({ url: null, timer_seconds: 10 })];
    mount();
    const row = (await screen.findByText("Follow us")).closest("li")!;
    expect(within(row).queryByText(/Stay for/)).toBeNull();
    expect(within(row).getByText("Claim")).toBeInTheDocument();
  });
});
