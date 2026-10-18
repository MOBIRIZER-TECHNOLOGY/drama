import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/test/admin-pages-dom";
import { fail, mockApi } from "@/test/api";
import { setAdmin } from "@/test/auth";
import { renderPage } from "@/test/render";
import UsersPage from "./page";

vi.mock("@/lib/auth", async () => (await import("@/test/auth")).authModule);

const user = (n: number, over: Record<string, unknown> = {}) => ({
  id: `u${n}`,
  public_id: `PID${n}`,
  display_name: `User ${n}`,
  avatar_url: null,
  email: `user${n}@example.com`,
  phone: null,
  status: "active",
  coin_balance: 100 * n,
  locale: "en",
  country: null,
  referral_code: null,
  created_at: "2025-01-02T10:00:00Z",
  last_seen_at: null,
  ...over,
});
const page = (items: unknown[], total = items.length) => ({ items, total });

let ue: ReturnType<typeof userEvent.setup>;
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  ue = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  setAdmin("owner");
  mockApi.get("/v1/admin/users/*/ledger", []);
  mockApi.get("/v1/admin/users/*", { is_vip: false, vip_ends_at: null, purchases: [] });
});
afterEach(() => {
  vi.useRealTimers();
});

const listCalls = () => mockApi.callsTo("GET", "/v1/admin/users");

describe("UsersPage listing", () => {
  it("renders rows with avatar/initial, contact, locale and badges, requesting limit+1", async () => {
    mockApi.get(
      "/v1/admin/users",
      page([
        user(1, { avatar_url: "https://img/x.png", phone: "+911", country: "IN", locale: "hi", status: "banned" }),
        user(2, { display_name: null, email: null, phone: null }),
      ]),
    );
    renderPage(<UsersPage />);
    expect(await screen.findByRole("button", { name: "User 1" })).toBeTruthy();
    expect(listCalls()[0].query).toEqual({ limit: "26", offset: "0" });
    const rows = screen.getAllByRole("row");
    const r1 = within(rows[1]);
    expect(r1.getByText("user1@example.com")).toBeTruthy();
    expect(r1.getByText("+911")).toBeTruthy();
    expect(r1.getByText("banned")).toBeTruthy();
    expect(r1.getByText("hi · IN")).toBeTruthy();
    expect(r1.getByText("100")).toBeTruthy();
    expect(rows[1].querySelector("img")?.getAttribute("src")).toBe("https://img/x.png");
    const r2 = within(rows[2]);
    expect(r2.getByText("No name")).toBeTruthy();
    expect(r2.getAllByText("—")).toHaveLength(2); // no contact, never seen
    expect(r2.getByText("P")).toBeTruthy(); // initial from public_id when there is no name
  });

  it("shows a loading state, then an empty state when nothing matches", async () => {
    mockApi.get("/v1/admin/users", page([]));
    renderPage(<UsersPage />);
    expect(screen.getByText(/Loading…/)).toBeTruthy();
    expect(await screen.findByText("No users found")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Pagination" })).toBeNull();
  });

  it("shows a full-page error that can be retried", async () => {
    mockApi.get("/v1/admin/users", fail(500, "db down"));
    renderPage(<UsersPage />);
    expect(await screen.findByText("db down")).toBeTruthy();
    mockApi.get("/v1/admin/users", page([user(1)]));
    await ue.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "User 1" })).toBeTruthy();
  });

  it("keeps stale rows and shows an inline error when a refetch fails", async () => {
    mockApi.get("/v1/admin/users", page([user(1)]));
    renderPage(<UsersPage />);
    await screen.findByRole("button", { name: "User 1" });
    mockApi.get("/v1/admin/users", fail(503, "flaky"));
    await ue.selectOptions(screen.getByLabelText("Status filter"), "banned");
    expect(await screen.findByText("flaky")).toBeTruthy();
    expect(screen.getByRole("button", { name: "User 1" })).toBeTruthy();
    mockApi.get("/v1/admin/users", page([user(1)]));
    await ue.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByText("flaky")).toBeNull());
  });
});

describe("UsersPage query state", () => {
  it("debounces the search and trims it", async () => {
    mockApi.get("/v1/admin/users", page([user(1)]));
    renderPage(<UsersPage />);
    await screen.findByRole("button", { name: "User 1" });
    await ue.type(screen.getByRole("searchbox"), "  ann ");
    expect(listCalls()).toHaveLength(1);
    await act(async () => void vi.advanceTimersByTime(300));
    await waitFor(() => expect(listCalls()).toHaveLength(2));
    expect(listCalls()[1].query.q).toBe("ann");
  });

  it("filters by status and returns to the first page", async () => {
    mockApi.get("/v1/admin/users", (c) => page(Array.from({ length: c.query.offset === "0" ? 26 : 3 }, (_, i) => user(i + 1))));
    renderPage(<UsersPage />);
    await screen.findByRole("button", { name: "User 1" });
    await ue.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(listCalls().at(-1)!.query.offset).toBe("25"));
    await ue.selectOptions(screen.getByLabelText("Status filter"), "banned");
    await waitFor(() => expect(listCalls().at(-1)!.query).toMatchObject({ status: "banned", offset: "0" }));
  });

  it("sorts server-side, toggling direction and resetting the page", async () => {
    mockApi.get("/v1/admin/users", page(Array.from({ length: 26 }, (_, i) => user(i + 1)), 40));
    renderPage(<UsersPage />);
    await screen.findByRole("button", { name: "User 1" });
    await ue.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(listCalls().at(-1)!.query.offset).toBe("25"));
    await ue.click(screen.getByRole("button", { name: /Coins/ }));
    await waitFor(() => expect(listCalls().at(-1)!.query).toMatchObject({ sort: "coin_balance", order: "asc", offset: "0" }));
    expect(screen.getByRole("columnheader", { name: /Coins/ }).getAttribute("aria-sort")).toBe("ascending");
    await ue.click(screen.getByRole("button", { name: /Coins/ }));
    await waitFor(() => expect(listCalls().at(-1)!.query).toMatchObject({ sort: "coin_balance", order: "desc" }));
    expect(screen.getByRole("columnheader", { name: /Coins/ }).getAttribute("aria-sort")).toBe("descending");
  });

  it("pages forward with a trimmed 25-row page, and explains an empty page past the end", async () => {
    mockApi.get("/v1/admin/users", (c) =>
      c.query.offset === "0" ? page(Array.from({ length: 26 }, (_, i) => user(i + 1)), 60) : page([], 60),
    );
    renderPage(<UsersPage />);
    await screen.findByRole("button", { name: "User 1" });
    expect(screen.getAllByRole("row")).toHaveLength(26); // header + 25
    expect(screen.queryByRole("button", { name: "User 26" })).toBeNull();
    await ue.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Nothing on this page")).toBeTruthy();
    expect(screen.getByText("Go back a page.")).toBeTruthy();
    await ue.click(screen.getByRole("button", { name: "Previous" }));
    expect(await screen.findByRole("button", { name: "User 1" })).toBeTruthy();
  });
});

describe("UsersPage drawer", () => {
  it("opens from the row or the name and closes again", async () => {
    mockApi.get("/v1/admin/users", page([user(1), user(2)]));
    renderPage(<UsersPage />);
    await ue.click(await screen.findByText("user2@example.com"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "User 2" })).toBeTruthy();
    await ue.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await ue.click(screen.getByRole("button", { name: "User 1" }));
    expect(within(await screen.findByRole("dialog")).getByRole("heading", { name: "User 1" })).toBeTruthy();
  });

  it("banning from the drawer updates the row in place", async () => {
    mockApi.get("/v1/admin/users", page([user(1)]));
    mockApi.put("/v1/admin/users/u1/status", (c) => user(1, { status: c.body.status }));
    renderPage(<UsersPage />);
    await ue.click(await screen.findByRole("button", { name: "User 1" }));
    await ue.click(await screen.findByRole("button", { name: "Ban user" }));
    const confirm = screen.getByRole("dialog", { name: "Ban user" });
    await ue.click(within(confirm).getByRole("button", { name: "Ban" }));
    await waitFor(() => expect(mockApi.callsTo("PUT", "/v1/admin/users/u1/status")[0].body).toEqual({ status: "banned" }));
    expect(await screen.findByText("User banned")).toBeTruthy();
    expect(within(screen.getAllByRole("row")[1]).getByText("banned")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ban" })).toBeNull();
  });

  it("deleting the user closes the drawer and refetches the list", async () => {
    mockApi.get("/v1/admin/users", page([user(1)]));
    mockApi.delete("/v1/admin/users/u1", undefined);
    renderPage(<UsersPage />);
    await ue.click(await screen.findByRole("button", { name: "User 1" }));
    await ue.click(await screen.findByRole("button", { name: "Delete user" }));
    const confirm = screen.getByRole("dialog", { name: "Delete user" });
    mockApi.get("/v1/admin/users", page([]));
    await ue.click(within(confirm).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("No users found")).toBeTruthy();
    expect(mockApi.callsTo("DELETE", "/v1/admin/users/u1")).toHaveLength(1);
    expect(listCalls()).toHaveLength(2);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
