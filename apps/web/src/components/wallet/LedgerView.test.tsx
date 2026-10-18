import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appWrapper } from "@/test-utils/app";
import { setAuth } from "@/test-utils/auth-context";
import { LedgerView } from "./LedgerView";

vi.mock("next/navigation", () => import("@/test-utils/next-navigation"));
vi.mock("@/lib/auth-context", () => import("@/test-utils/auth-context"));
const GET = vi.fn();
vi.mock("@/lib/client-api", () => ({ clientApi: { GET: (...a: unknown[]) => GET(...a) } }));
const downloadCsv = vi.fn();
vi.mock("@/lib/csv", () => ({ downloadCsv: (...a: unknown[]) => downloadCsv(...a) }));

const res = (ok = true, status = 200) => ({ ok, status }) as Response;
const row = (i: number, over: object = {}) => ({
  id: `r${i}`,
  kind: "purchase",
  delta: 100,
  balance_after: 100 + i,
  note: null,
  ref_type: null,
  created_at: "2026-03-15T10:00:00Z",
  ...over,
});

function mount(lang = "en") {
  return render(<LedgerView />, { wrapper: appWrapper({ lang }) });
}

beforeEach(() => {
  GET.mockReset();
  downloadCsv.mockReset();
  setAuth({ status: "authenticated" });
});

describe("LedgerView", () => {
  it("shows the sign-in prompt for anonymous users without loading", () => {
    setAuth({ status: "anonymous" });
    mount();
    expect(screen.getByText("Sign in to continue")).toBeInTheDocument();
    expect(GET).not.toHaveBeenCalled();
  });

  it("shows skeletons while loading then the empty state", async () => {
    GET.mockResolvedValue({ data: [], response: res() });
    const { container } = mount();
    expect(container.querySelectorAll(".k-skeleton").length).toBe(6);
    expect(await screen.findByText("No transactions yet")).toBeInTheDocument();
    expect(screen.queryByText("Export CSV")).toBeNull();
    expect(GET).toHaveBeenCalledWith("/v1/wallet/ledger", { params: { query: { limit: 50, before: undefined } } });
  });

  it("shows an error with retry that reloads", async () => {
    GET.mockResolvedValueOnce({ error: { detail: "x" }, response: res(false, 500) });
    mount();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    GET.mockResolvedValueOnce({ data: [row(1)], response: res() });
    fireEvent.click(screen.getByText("Try again"));
    expect(await screen.findByText("Top-up", { selector: "p" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders rows, signs, labels, notes and totals; unknown kinds fall back to the wire value", async () => {
    GET.mockResolvedValue({
      data: [
        row(1, { delta: 200, note: "Welcome", kind: "signup_bonus" }),
        row(2, { delta: -30, kind: "unlock", ref_type: "episode" }),
        row(3, { delta: 0, kind: "mystery" }),
      ],
      response: res(),
    });
    mount();
    await screen.findByText("Welcome bonus", { selector: "td" });
    expect(screen.getByText("Earned 200 · Spent 30")).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getByText("+200")).toBeInTheDocument();
    expect(within(table).getByText("-30")).toBeInTheDocument();
    expect(within(table).getByText("+0")).toBeInTheDocument();
    expect(within(table).getByText("Episode unlock")).toBeInTheDocument();
    expect(within(table).getByText("mystery")).toBeInTheDocument();
    expect(within(table).getByText("episode")).toBeInTheDocument(); // ref_type shown when no note
    // mobile list carries the note inline
    expect(screen.getAllByText(/· Welcome/).length).toBe(1);
  });

  it("filters earned / spent / all, and groups by month in the viewer's locale", async () => {
    GET.mockResolvedValue({
      data: [
        row(1, { delta: 10, created_at: "2026-03-15T10:00:00Z" }),
        row(2, { delta: -5, created_at: "2026-03-10T10:00:00Z" }),
        row(3, { delta: 7, created_at: "2026-02-10T10:00:00Z" }),
      ],
      response: res(),
    });
    mount();
    await screen.findByText("March 2026");
    expect(screen.getByText("February 2026")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Spent", { selector: "button" }));
    expect(screen.queryByText("February 2026")).toBeNull();
    expect(screen.getByText("March 2026")).toBeInTheDocument();
    expect(screen.getByText("Spent", { selector: "button" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByText("Earned", { selector: "button" }));
    expect(within(screen.getByRole("table")).queryByText("-5")).toBeNull();
    fireEvent.click(screen.getByText("All"));
    expect(within(screen.getByRole("table")).getByText("-5")).toBeInTheDocument();
  });

  it("falls back to the raw month key for an unsupported locale", async () => {
    GET.mockResolvedValue({ data: [row(1)], response: res() });
    mount("zz-invalid-locale-!!");
    await screen.findByText("2026-2");
  });

  it("exports exactly the filtered rows with human labels", async () => {
    GET.mockResolvedValue({ data: [row(1, { delta: -5, kind: "unlock" }), row(2, { delta: 9, kind: "purchase" })], response: res() });
    mount();
    await screen.findByText("Export CSV");
    fireEvent.click(screen.getByText("Spent", { selector: "button" }));
    fireEvent.click(screen.getByText("Export CSV"));
    expect(downloadCsv).toHaveBeenCalledTimes(1);
    const [name, cols, rows] = downloadCsv.mock.calls[0];
    expect(name).toMatch(/^katha-coins-\d{4}-\d{2}-\d{2}$/);
    expect(cols.map((c: { key: string }) => c.key)).toEqual(["created_at", "kind", "delta", "balance_after", "note"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "Episode unlock", delta: -5 });
  });

  it("exports the wire kind when the kind is unknown", async () => {
    GET.mockResolvedValue({ data: [row(1, { kind: "weird" })], response: res() });
    mount();
    fireEvent.click(await screen.findByText("Export CSV"));
    expect(downloadCsv.mock.calls[0][2][0].kind).toBe("weird");
  });

  it("paginates with the last row's timestamp and appends", async () => {
    const page = Array.from({ length: 50 }, (_, i) => row(i, { created_at: `2026-03-${String(20 - (i % 10)).padStart(2, "0")}T10:00:00Z` }));
    GET.mockResolvedValueOnce({ data: page, response: res() });
    mount();
    const more = await screen.findByText("Load more");
    GET.mockResolvedValueOnce({ data: [row(99, { id: "last" })], response: res() });
    await act(async () => fireEvent.click(more));
    expect(GET).toHaveBeenLastCalledWith("/v1/wallet/ledger", { params: { query: { limit: 50, before: page[49].created_at } } });
    await waitFor(() => expect(screen.queryByText("Load more")).toBeNull());
    expect(screen.getByText("Earned 5,100 · Spent 0")).toBeInTheDocument();
  });

  it("keeps existing rows when loading more fails", async () => {
    const page = Array.from({ length: 50 }, (_, i) => row(i));
    GET.mockResolvedValueOnce({ data: page, response: res() });
    mount();
    const more = await screen.findByText("Load more");
    GET.mockResolvedValueOnce({ error: { detail: "x" }, response: res(false, 500) });
    await act(async () => fireEvent.click(more));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Load more")).toBeInTheDocument();
  });

  it("links back to the wallet using the language prefix", async () => {
    GET.mockResolvedValue({ data: [], response: res() });
    mount("hi");
    await screen.findByText("No transactions yet");
    expect(screen.getByText("Wallet").closest("a")!.getAttribute("href")).toBe("/hi/wallet");
  });
});
