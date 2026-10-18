import "@/test/dom-matchers-pages";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderPage } from "@/test/render";
import { fail, mockApi } from "@/test/api";
import Page from "./page";

const PU = (over: Record<string, unknown> = {}) => ({
  id: "11111111-2222-3333-4444-555555555555",
  user_id: "99999999-8888-7777-6666-555555555555",
  user_public_id: "U-1001",
  user_email: "a@example.com",
  pack_name: "Starter",
  gateway: "stripe",
  gateway_payment_id: "pi_123",
  status: "paid",
  currency: "USD",
  amount: 5,
  coins_granted: 100,
  created_at: "2026-01-02T03:04:05Z",
  paid_at: "2026-01-02T03:05:05Z",
  ...over,
});
const page = (items: unknown[], over: Record<string, unknown> = {}) => ({ items, total: items.length, totals_by_currency: {}, ...over });

afterEach(() => vi.useRealTimers());

describe("PurchasesPage", () => {
  it("shows loading then rows with ids, user, status and money", async () => {
    mockApi.get("/v1/admin/purchases", page([
      PU(),
      PU({ id: "short", user_public_id: null, user_email: null, gateway_payment_id: null, status: "refunded", paid_at: null, currency: "INR", amount: 99, coins_granted: 10 }),
    ], { totals_by_currency: { USD: 5, INR: 99 } }));
    renderPage(<Page />);
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(await screen.findByText("11111111…")).toBeInTheDocument();
    expect(screen.getByText("pi_123")).toBeInTheDocument();
    expect(screen.getByText("U-1001")).toBeInTheDocument();
    expect(screen.getByText("99999999…")).toBeInTheDocument();
    expect(screen.getByText("a@example.com")).toBeInTheDocument();
    expect(screen.getByText("paid")).toBeInTheDocument();
    expect(screen.getByText("refunded")).toBeInTheDocument();
    expect(screen.getByText("On this page (USD):")).toBeInTheDocument();
    expect(screen.queryByText("On this page (INR):")).toBeNull(); // only paid rows count
    expect(screen.getByText(/1 order · 100 coins/)).toBeInTheDocument();
    expect(screen.getByText(/All 2 orders:/)).toBeInTheDocument();
    expect(screen.getAllByText("₹99.00")).toHaveLength(2); // row amount and whole-set total
    expect(screen.getByRole("button", { name: "Export page (2)" })).not.toBeDisabled();
    const [c] = mockApi.callsTo("GET", "/v1/admin/purchases");
    expect(c.query).toEqual({ limit: "50", offset: "0" });
  });
  it("sums multiple paid orders per currency, pluralised", async () => {
    mockApi.get("/v1/admin/purchases", page([PU(), PU({ id: "b", amount: 7, coins_granted: 50 })], { total: 1, totals_by_currency: { USD: 12 } }));
    renderPage(<Page />);
    expect(await screen.findByText(/2 orders · 150 coins/)).toBeInTheDocument();
    expect(screen.getByText("$12.00", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText(/All 1 order:/)).toBeInTheDocument();
  });
  it("empty first load", async () => {
    mockApi.get("/v1/admin/purchases", page([]));
    renderPage(<Page />);
    expect(await screen.findByText("No purchases")).toBeInTheDocument();
    expect(screen.getByText("Orders appear here once checkout starts.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export page (0)" })).toBeDisabled();
    expect(screen.queryByRole("navigation", { name: "Pagination" })).toBeNull();
  });
  it("error then retry", async () => {
    mockApi.get("/v1/admin/purchases", () => fail(500, "db gone"));
    renderPage(<Page />);
    expect(await screen.findByText("db gone")).toBeInTheDocument();
    mockApi.get("/v1/admin/purchases", page([PU()]));
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("pi_123")).toBeInTheDocument();
  });

  it("filters by status server-side and explains an empty status", async () => {
    mockApi.get("/v1/admin/purchases", page([PU()]));
    renderPage(<Page />);
    await screen.findByText("pi_123");
    mockApi.get("/v1/admin/purchases", page([]));
    await userEvent.selectOptions(screen.getByLabelText("Status filter"), "failed");
    expect(await screen.findByText("None with this status.")).toBeInTheDocument();
    expect(mockApi.callsTo("GET", "/v1/admin/purchases").at(-1)!.query).toMatchObject({ status: "failed", offset: "0" });
  });
  it("status filter shows in the totals line", async () => {
    mockApi.get("/v1/admin/purchases", page([PU()], { totals_by_currency: { USD: 5 } }));
    renderPage(<Page />);
    await screen.findByText("pi_123");
    await userEvent.selectOptions(screen.getByLabelText("Status filter"), "paid");
    expect(await screen.findByText(/All 1 paid order:/)).toBeInTheDocument();
  });
  it("debounces search by 300ms and sends q; shows no-match copy", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockApi.get("/v1/admin/purchases", page([PU()]));
    renderPage(<Page />);
    await screen.findByText("pi_123");
    const before = mockApi.callsTo("GET", "/v1/admin/purchases").length;
    mockApi.get("/v1/admin/purchases", page([]));
    const box = screen.getByRole("searchbox");
    fireEvent.change(box, { target: { value: "  pi_9  " } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(mockApi.callsTo("GET", "/v1/admin/purchases")).toHaveLength(before);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(await screen.findByText("No matches")).toBeInTheDocument();
    expect(screen.getByText(/Try a different id, email or date range/)).toBeInTheDocument();
    expect(mockApi.callsTo("GET", "/v1/admin/purchases").at(-1)!.query.q).toBe("pi_9");
  });
  it("date range goes to the API and also reads as no-match", async () => {
    mockApi.get("/v1/admin/purchases", page([PU()]));
    renderPage(<Page />);
    await screen.findByText("pi_123");
    mockApi.get("/v1/admin/purchases", page([]));
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-02-01" } });
    expect(await screen.findByText("No matches")).toBeInTheDocument();
    expect(mockApi.callsTo("GET", "/v1/admin/purchases").at(-1)!.query).toMatchObject({ date_from: "2026-01-01", date_to: "2026-02-01" });
  });

  it("paginates: next, numbered pages, back to first; empty later page; rows per page", async () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => PU({ id: `row-${i}-${Math.random()}`, gateway_payment_id: `pay_${i}` }));
    mockApi.get("/v1/admin/purchases", (c) => {
      const off = Number(c.query.offset);
      const lim = Number(c.query.limit);
      return { items: off >= 100 ? [] : mk(Math.min(lim, 100 - off)), total: 100, totals_by_currency: {} };
    });
    renderPage(<Page />);
    await screen.findByText("pay_0");
    const nav = screen.getByRole("navigation", { name: "Pagination" });
    expect(nav).toHaveTextContent("1–50 of 100 · page 1 of 2");
    await userEvent.click(within(nav).getByRole("button", { name: "Next" }));
    await waitFor(() => expect(mockApi.callsTo("GET", "/v1/admin/purchases").at(-1)!.query.offset).toBe("50"));
    await waitFor(() => expect(screen.getByRole("navigation", { name: "Pagination" })).toHaveTextContent("51–100 of 100 · page 2 of 2"));
    await userEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "First" }));
    await waitFor(() => expect(screen.getByRole("navigation")).toHaveTextContent("1–50"));
    await userEvent.selectOptions(within(screen.getByRole("navigation")).getByRole("combobox"), "20");
    await waitFor(() => expect(mockApi.callsTo("GET", "/v1/admin/purchases").at(-1)!.query).toMatchObject({ limit: "20", offset: "0" }));
  });
  it("past the end says nothing on this page", async () => {
    mockApi.get("/v1/admin/purchases", (c) => (c.query.offset === "0" ? { items: [PU()], total: 120, totals_by_currency: {} } : { items: [], total: 120, totals_by_currency: {} }));
    renderPage(<Page />);
    await screen.findByText("pi_123");
    await userEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Last" }));
    expect(await screen.findByText("Nothing on this page")).toBeInTheDocument();
    expect(screen.getByText("Go back a page.")).toBeInTheDocument();
    expect(screen.getByRole("navigation")).toHaveTextContent("No rows on this page");
  });

  it("shows a stale-data banner when a refetch fails, and 'Refreshing…' while loading", async () => {
    mockApi.get("/v1/admin/purchases", page([PU()]));
    renderPage(<Page />);
    await screen.findByText("pi_123");
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    mockApi.get("/v1/admin/purchases", async () => {
      await gate;
      return fail(503, "flaky");
    });
    await userEvent.selectOptions(screen.getByLabelText("Status filter"), "pending");
    expect(await screen.findByText("Refreshing…")).toBeInTheDocument();
    release();
    const alert = await screen.findByText("flaky");
    expect(alert).toBeInTheDocument();
    expect(screen.getByText("pi_123")).toBeInTheDocument();
    mockApi.get("/v1/admin/purchases", page([PU({ gateway_payment_id: "pi_new" })]));
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("pi_new")).toBeInTheDocument();
  });

  it("exports the visible rows as CSV with a dated name and falls back to the internal user id", async () => {
    mockApi.get("/v1/admin/purchases", page([PU(), PU({ id: "b", user_public_id: null, pack_name: "=Evil, \"pack\"" })]));
    let blob: Blob | undefined;
    const created = vi.fn((b: Blob) => ((blob = b), "blob:x"));
    const revoked = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { value: created, configurable: true, writable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: revoked, configurable: true, writable: true });
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    renderPage(<Page />);
    await screen.findAllByText("pi_123");
    await userEvent.click(screen.getByRole("button", { name: "Export page (2)" }));
    expect(names[0]).toBe(`katha-purchases-${new Date().toISOString().slice(0, 10)}.csv`);
    expect(revoked).toHaveBeenCalledWith("blob:x");
    const text = await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.readAsText(blob!);
    });
    const lines = text.replace(/^﻿/, "").split("\r\n");
    expect(lines[0]).toBe("Order,User,Pack,Gateway,Status,Currency,Amount,Coins,Created,Paid");
    expect(lines[1]).toContain(",U-1001,Starter,stripe,paid,USD,5,100,");
    expect(lines[2]).toContain(",99999999-8888-7777-6666-555555555555,\"'=Evil, \"\"pack\"\"\",");
  });
});
