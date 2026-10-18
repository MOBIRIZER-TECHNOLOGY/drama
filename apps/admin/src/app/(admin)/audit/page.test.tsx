import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/test/admin-pages-dom";
import { fail, mockApi } from "@/test/api";
import { renderPage } from "@/test/render";
import AuditPage from "./page";

const downloadCsv = vi.hoisted(() => vi.fn());
vi.mock("@/lib/editing", async (orig) => ({ ...(await orig<typeof import("@/lib/editing")>()), downloadCsv }));

const row = (n: number, over: Record<string, unknown> = {}) => ({
  id: `a${n}`,
  created_at: "2025-05-06T07:08:00Z",
  admin_email: `admin${n}@example.com`,
  action: "user.status",
  target_type: "user",
  target_id: "0123456789abcdef",
  note: `note ${n}`,
  before: { status: "active" },
  after: { status: "banned" },
  ...over,
});
const feed = (items: unknown[], total = items.length) => ({ items, total });
const calls = () => mockApi.callsTo("GET", "/v1/admin/audit");

const ue = userEvent.setup();
beforeEach(() => downloadCsv.mockClear());

describe("AuditPage", () => {
  it("renders the trail with labelled actions, short targets and change summaries", async () => {
    mockApi.get(
      "/v1/admin/audit",
      feed([
        row(1),
        row(2, { action: "custom.thing", target_type: null, target_id: null, note: null, admin_email: null, before: null, after: null }),
        row(3, { action: "flag.set", before: null, after: { enabled: true, a: 1, b: 2, c: 3 }, target_id: null }),
      ]),
    );
    renderPage(<AuditPage />);
    expect(await screen.findByText("Ban / unban")).toBeTruthy();
    expect(calls()[0].query).toEqual({ limit: "50", offset: "0" });
    expect(screen.getByText('status: "active" → "banned"')).toBeTruthy();
    expect(screen.getByText("user:01234567")).toBeTruthy();
    expect(screen.getByText("custom.thing")).toBeTruthy(); // unknown actions keep their raw name
    expect(screen.getByText('enabled: true, a: 1, b: 2')).toBeTruthy(); // new keys only, first three
    expect(screen.getByText("user:")).toBeTruthy(); // target type with no id
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);
  });

  it("filters server-side by action and resets paging", async () => {
    mockApi.get("/v1/admin/audit", feed([row(1)], 200));
    renderPage(<AuditPage />);
    await screen.findByText("Ban / unban");
    await ue.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(calls().at(-1)!.query.offset).toBe("50"));
    await ue.selectOptions(screen.getByLabelText("Action filter"), "user.coins");
    await waitFor(() => expect(calls().at(-1)!.query).toEqual({ action: "user.coins", limit: "50", offset: "0" }));
  });

  it("searches only within the loaded page and explains when nothing matches", async () => {
    const bare = row(3, { admin_email: null, target_type: null, target_id: null, note: null });
    mockApi.get("/v1/admin/audit", feed([row(1), row(2, { admin_email: "other@example.com", note: "refund" }), bare]));
    renderPage(<AuditPage />);
    await screen.findByText("note 1");
    await ue.type(screen.getByRole("searchbox"), "0123456789ABCDEF");
    expect(screen.queryAllByRole("row")).toHaveLength(3); // header + the two rows that carry that target
    await ue.clear(screen.getByRole("searchbox"));
    await ue.type(screen.getByRole("searchbox"), "REFUND");
    expect(screen.queryByText("note 1")).toBeNull();
    expect(screen.getByText("refund")).toBeTruthy();
    expect(calls()).toHaveLength(1); // no refetch for a local filter
    await ue.clear(screen.getByRole("searchbox"));
    await ue.type(screen.getByRole("searchbox"), "no-such-thing");
    expect(screen.getByText("No matches on this page")).toBeTruthy();
    expect(screen.getByText("Search applies to the rows loaded on this page.")).toBeTruthy();
  });

  it("shows the empty state, a page-past-the-end state and a disabled export", async () => {
    mockApi.get("/v1/admin/audit", (c) => feed([], c.query.offset === "0" ? 0 : 100));
    renderPage(<AuditPage />);
    expect(await screen.findByText("Nothing recorded yet")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Export CSV" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("navigation", { name: "Pagination" })).toBeNull();
  });

  it("explains an empty later page and lets the operator page back", async () => {
    mockApi.get("/v1/admin/audit", (c) => (c.query.offset === "0" ? feed([row(1)], 100) : feed([], 100)));
    renderPage(<AuditPage />);
    await screen.findByText("note 1");
    await ue.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Nothing on this page")).toBeTruthy();
    await ue.click(screen.getByRole("button", { name: "Previous" }));
    expect(await screen.findByText("note 1")).toBeTruthy();
  });

  it("changes page size", async () => {
    mockApi.get("/v1/admin/audit", feed([row(1)], 500));
    renderPage(<AuditPage />);
    await screen.findByText("note 1");
    await ue.selectOptions(screen.getByRole("combobox", { name: "Rows per page" }), "100");
    await waitFor(() => expect(calls().at(-1)!.query).toEqual({ limit: "100", offset: "0" }));
  });

  it("exports the visible rows as CSV with a dated filename and a change column", async () => {
    mockApi.get("/v1/admin/audit", feed([row(1), row(2, { note: "refund" })]));
    renderPage(<AuditPage />);
    await screen.findByText("note 1");
    await ue.type(screen.getByRole("searchbox"), "refund");
    await ue.click(screen.getByRole("button", { name: "Export CSV" }));
    expect(downloadCsv).toHaveBeenCalledTimes(1);
    const [name, columns, rows] = downloadCsv.mock.calls[0];
    expect(name).toBe(`katha-audit-${new Date().toISOString().slice(0, 10)}`);
    expect(columns.map((c: { key: string }) => c.key)).toEqual(["created_at", "admin_email", "action", "target_type", "target_id", "note", "change"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "a2", change: 'status: "active" → "banned"' });
  });

  it("shows an error that can be retried, and an inline one over stale rows", async () => {
    mockApi.get("/v1/admin/audit", fail(500, "audit down"));
    renderPage(<AuditPage />);
    expect(await screen.findByText("audit down")).toBeTruthy();
    mockApi.get("/v1/admin/audit", feed([row(1)]));
    await ue.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("note 1");
    mockApi.get("/v1/admin/audit", fail(500, "second failure"));
    await ue.selectOptions(screen.getByLabelText("Action filter"), "flag.set");
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("second failure")).toBeTruthy();
    expect(screen.getByText("note 1")).toBeTruthy();
  });

  it("shows loading first", () => {
    mockApi.get("/v1/admin/audit", feed([]));
    renderPage(<AuditPage />);
    expect(screen.getByText(/Loading…/)).toBeTruthy();
  });
});
