import "@/test/dramas-dom-matchers";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fail, mockApi } from "@/test/api";
import { setAdmin } from "@/test/auth";
import { renderPage } from "@/test/render";
import { UserDrawer } from "./user-drawer";

vi.mock("@/lib/auth", async () => (await import("@/test/auth")).authModule);

const user = (over: Record<string, unknown> = {}) =>
  ({
    id: "u1",
    public_id: "KU-123",
    display_name: "Asha",
    email: "asha@example.com",
    phone: "+911234",
    locale: "hi",
    country: "IN",
    referral_code: "ASHA1",
    status: "active",
    coin_balance: 500,
    created_at: "2030-01-01T00:00:00Z",
    last_seen_at: null,
    ...over,
  }) as never;

const detail = (over: Record<string, unknown> = {}) => ({ ...(user() as object), is_vip: false, vip_ends_at: null, purchases: [], ...over });
const ledgerRow = (over: Record<string, unknown> = {}) => ({
  id: "l1",
  kind: "admin_grant",
  delta: 100,
  balance_after: 600,
  note: "welcome",
  ref_type: null,
  ref_id: null,
  created_at: "2030-01-02T00:00:00Z",
  ...over,
});

function setup(u = user(), extra: { onDeleted?: (id: string) => void } = {}) {
  const onClose = vi.fn();
  const onUpdated = vi.fn();
  const utils = renderPage(<UserDrawer user={u} onClose={onClose} onUpdated={onUpdated} onDeleted={extra.onDeleted} />);
  return { onClose, onUpdated, ...utils };
}
const confirm = (name: string) => within(screen.getByRole("dialog", { name }));

beforeEach(() => {
  setAdmin("owner");
  mockApi.get("/v1/admin/users/u1/ledger", [ledgerRow()]);
  mockApi.get("/v1/admin/users/u1", detail());
});

describe("UserDrawer details", () => {
  it("shows the profile, purchases and ledger", async () => {
    mockApi.get(
      "/v1/admin/users/u1",
      detail({
        purchases: [
          { id: "p1", paid_at: "2030-02-01T00:00:00Z", created_at: "2030-01-31T00:00:00Z", pack_name: "Big pack", gateway: "razorpay", gateway_payment_id: "pay_1", status: "paid", amount: 499, currency: "INR", coins_granted: 600 },
          { id: "p2", paid_at: null, created_at: "2030-01-31T00:00:00Z", pack_name: null, gateway: "stripe", gateway_payment_id: null, status: "pending", amount: 5, currency: "USD", coins_granted: 0 },
        ],
      }),
    );
    mockApi.get("/v1/admin/users/u1/ledger", [
      ledgerRow(),
      ledgerRow({ id: "l2", kind: "episode_unlock", delta: -20, balance_after: 580, note: null, ref_type: "episode", ref_id: "e9" }),
      ledgerRow({ id: "l3", kind: "bonus", delta: 5, note: null, ref_type: null }),
      ledgerRow({ id: "l4", kind: "refund", delta: 5, note: null, ref_type: "order", ref_id: null }),
    ]);
    setup();
    const dlg = screen.getByRole("dialog", { name: "Asha" });
    expect(dlg).toHaveTextContent("KU-123");
    expect(dlg).toHaveTextContent("asha@example.com");
    expect(dlg).toHaveTextContent("+911234");
    expect(dlg).toHaveTextContent("hi · IN");
    expect(dlg).toHaveTextContent("ASHA1");
    expect(dlg).toHaveTextContent("500");
    expect(await screen.findByText("Big pack")).toBeInTheDocument();
    expect(screen.getByText("razorpay")).toHaveAttribute("title", "pay_1");
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(await screen.findByText("welcome")).toBeInTheDocument();
    expect(screen.getByText("episode unlock")).toBeInTheDocument();
    expect(screen.getByText("-20")).toBeInTheDocument();
    expect(screen.getByText("+100")).toBeInTheDocument();
    expect(screen.getByText("episode e9")).toBeInTheDocument();
    expect(screen.getByText("order")).toBeInTheDocument();
    expect(mockApi.callsTo("GET", "/v1/admin/users/u1/ledger")[0].query).toEqual({ limit: "50" });
  });

  it("falls back to the public id and em-dashes for missing fields", async () => {
    setup(user({ display_name: null, email: null, phone: null, country: null, referral_code: null }));
    const dlg = screen.getByRole("dialog", { name: "KU-123" });
    expect(dlg.textContent).toContain("Localehi");
    expect(dlg.textContent).not.toContain("hi ·");
    expect(within(dlg).getAllByText("—").length).toBeGreaterThanOrEqual(4);
    expect(await screen.findByText("No purchases")).toBeInTheDocument();
  });

  it("shows empty ledger and loading states", async () => {
    mockApi.get("/v1/admin/users/u1/ledger", []);
    setup();
    expect(screen.getAllByText("Loading…").length).toBeGreaterThan(0);
    expect(await screen.findByText("No ledger entries")).toBeInTheDocument();
  });

  it("offers retry when the detail or ledger request fails", async () => {
    mockApi.get("/v1/admin/users/u1", fail(500, "detail down"));
    mockApi.get("/v1/admin/users/u1/ledger", fail(500, "ledger down"));
    setup();
    expect(await screen.findByText("detail down")).toBeInTheDocument();
    expect(await screen.findByText("ledger down")).toBeInTheDocument();
    mockApi.get("/v1/admin/users/u1", detail());
    mockApi.get("/v1/admin/users/u1/ledger", [ledgerRow()]);
    const retries = screen.getAllByRole("button", { name: /Retry|Try again/i });
    for (const r of retries) await userEvent.click(r);
    expect(await screen.findByText("No purchases")).toBeInTheDocument();
    expect(await screen.findByText("welcome")).toBeInTheDocument();
  });

  it("reports active VIP, no VIP, and the pending check", async () => {
    mockApi.get("/v1/admin/users/u1", detail({ is_vip: true, vip_ends_at: "2031-01-01T00:00:00Z" }));
    setup();
    expect(screen.getByText("Checking current VIP…")).toBeInTheDocument();
    expect(await screen.findByText(/Active until 01 Jan 2031/)).toBeInTheDocument();
  });

  it("says there is no active VIP", async () => {
    setup();
    expect(await screen.findByText("No active VIP.")).toBeInTheDocument();
  });
});

describe("UserDrawer status", () => {
  it("bans after confirmation", async () => {
    mockApi.put("/v1/admin/users/u1/status", (c) => ({ ...(user() as object), status: c.body.status }));
    const { onUpdated } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Ban user" }));
    expect(confirm("Ban user").getByText(/Ban Asha\?/)).toBeInTheDocument();
    await userEvent.click(confirm("Ban user").getByRole("button", { name: "Ban" }));
    expect(await screen.findByText("User banned")).toBeInTheDocument();
    expect(mockApi.callsTo("PUT", "/v1/admin/users/u1/status")[0].body).toEqual({ status: "banned" });
    expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ status: "banned" }));
    expect(screen.queryByRole("dialog", { name: "Ban user" })).toBeNull();
  });

  it("cancelling the ban sends nothing", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Ban user" }));
    await userEvent.click(confirm("Ban user").getByRole("button", { name: "Cancel" }));
    expect(mockApi.callsTo("PUT")).toHaveLength(0);
  });

  it("unbans a banned user without confirmation", async () => {
    mockApi.put("/v1/admin/users/u1/status", { ...(user() as object), status: "active" });
    const { onUpdated } = setup(user({ status: "banned" }));
    expect(screen.queryByRole("button", { name: "Ban user" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Unban user" }));
    expect(await screen.findByText("User reactivated")).toBeInTheDocument();
    expect(mockApi.callsTo("PUT", "/v1/admin/users/u1/status")[0].body).toEqual({ status: "active" });
    expect(onUpdated).toHaveBeenCalled();
  });

  it("shows a status failure", async () => {
    mockApi.put("/v1/admin/users/u1/status", fail(500, "cannot"));
    const { onUpdated } = setup(user({ status: "banned" }));
    await userEvent.click(screen.getByRole("button", { name: "Unban user" }));
    expect(await screen.findByText("cannot")).toBeInTheDocument();
    expect(onUpdated).not.toHaveBeenCalled();
  });

  it("a deleted account has no ban or delete actions", () => {
    setup(user({ status: "deleted" }), { onDeleted: vi.fn() });
    expect(screen.getByText("This account is deleted.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete user" })).toBeNull();
  });
});

describe("UserDrawer delete", () => {
  it("is owner-only and needs an onDeleted handler", () => {
    setup();
    expect(screen.queryByRole("button", { name: "Delete user" })).toBeNull();
  });

  it("is hidden from non-owners", () => {
    setAdmin("support");
    setup(user(), { onDeleted: vi.fn() });
    expect(screen.queryByRole("button", { name: "Delete user" })).toBeNull();
  });

  it("deletes after confirmation", async () => {
    mockApi.delete("/v1/admin/users/u1", undefined);
    const onDeleted = vi.fn();
    setup(user(), { onDeleted });
    await userEvent.click(screen.getByRole("button", { name: "Delete user" }));
    await userEvent.click(confirm("Delete user").getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("User deleted")).toBeInTheDocument();
    expect(onDeleted).toHaveBeenCalledWith("u1");
    expect(mockApi.callsTo("DELETE", "/v1/admin/users/u1")).toHaveLength(1);
  });

  it("reports a delete failure and does not call onDeleted", async () => {
    mockApi.delete("/v1/admin/users/u1", fail(409, "has orders"));
    const onDeleted = vi.fn();
    setup(user(), { onDeleted });
    await userEvent.click(screen.getByRole("button", { name: "Delete user" }));
    await userEvent.click(confirm("Delete user").getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("has orders")).toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("cancelling closes the confirmation", async () => {
    setup(user(), { onDeleted: vi.fn() });
    await userEvent.click(screen.getByRole("button", { name: "Delete user" }));
    await userEvent.click(confirm("Delete user").getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Delete user" })).toBeNull();
  });
});

describe("UserDrawer role gating", () => {
  it.each(["support", "content", "analyst"] as const)("hides money forms from %s", (role) => {
    setAdmin(role as never);
    setup();
    expect(screen.queryByText("Adjust coins")).toBeNull();
    expect(screen.queryByLabelText(/^Delta/)).toBeNull();
    expect(screen.queryByLabelText(/^Days/)).toBeNull();
  });

  it("shows money forms to finance", () => {
    setAdmin("finance");
    setup();
    expect(screen.getByText("Adjust coins")).toBeInTheDocument();
  });
});

describe("UserDrawer coins", () => {
  const delta = () => screen.getByLabelText(/^Delta/);
  const note = () => screen.getByLabelText(/^Note\s*\*/);
  const coinsForm = () => within(screen.getByText("Adjust coins").closest("form") as HTMLFormElement);
  const apply = () => userEvent.click(coinsForm().getByRole("button", { name: "Apply" }));

  it("validates delta and note", async () => {
    setup();
    await apply();
    expect(screen.getByText("Enter a non-zero whole number.")).toBeInTheDocument();
    expect(screen.getByText(/at least 3 characters/)).toBeInTheDocument();
    expect(delta()).toHaveFocus();
    await userEvent.type(delta(), "0");
    await apply();
    expect(screen.getByText("Enter a non-zero whole number.")).toBeInTheDocument();
    await userEvent.clear(delta());
    await userEvent.type(delta(), "1.5");
    await apply();
    expect(screen.getByText("Enter a non-zero whole number.")).toBeInTheDocument();
    await userEvent.clear(delta());
    await userEvent.type(delta(), "-600");
    await userEvent.type(note(), "ab");
    await apply();
    expect(screen.getByText("That would leave the balance at -100; it cannot go below 0.")).toBeInTheDocument();
    // typing clears the matching error
    await userEvent.type(note(), "c");
    expect(screen.queryByText(/at least 3 characters/)).toBeNull();
    expect(mockApi.callsTo("POST", "/v1/admin/users/u1/coins")).toHaveLength(0);
  });

  it("grants a small amount directly and refreshes the ledger", async () => {
    mockApi.post("/v1/admin/users/u1/coins", { ...(user() as object), coin_balance: 600 });
    const { onUpdated } = setup();
    await screen.findByText("welcome");
    await userEvent.type(delta(), "100");
    await userEvent.type(note(), "  goodwill  ");
    await apply();
    expect(await screen.findByText("Granted 100 coins; balance is now 600")).toBeInTheDocument();
    expect(mockApi.callsTo("POST", "/v1/admin/users/u1/coins")[0].body).toEqual({ delta: 100, note: "goodwill" });
    expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ coin_balance: 600 }));
    expect(delta()).toHaveValue("");
    expect(note()).toHaveValue("");
    await waitFor(() => expect(mockApi.callsTo("GET", "/v1/admin/users/u1/ledger").length).toBeGreaterThanOrEqual(2));
    expect(mockApi.callsTo("GET", "/v1/admin/users/u1").length).toBeGreaterThanOrEqual(2);
  });

  it("asks for confirmation before a deduction and shows the resulting balance", async () => {
    mockApi.post("/v1/admin/users/u1/coins", { ...(user() as object), coin_balance: 450 });
    setup();
    await userEvent.type(delta(), "-50");
    await userEvent.type(note(), "fraud");
    await apply();
    const dlg = confirm("Remove coins");
    expect(dlg.getByText("-50")).toBeInTheDocument();
    expect(dlg.getByText("450")).toBeInTheDocument();
    expect(dlg.getByText("fraud")).toBeInTheDocument();
    expect(mockApi.callsTo("POST", "/v1/admin/users/u1/coins")).toHaveLength(0);
    await userEvent.click(dlg.getByRole("button", { name: "Remove coins" }));
    expect(await screen.findByText("Removed 50 coins; balance is now 450")).toBeInTheDocument();
    expect(mockApi.callsTo("POST", "/v1/admin/users/u1/coins")[0].body).toEqual({ delta: -50, note: "fraud" });
  });

  it("asks for confirmation on a large grant, and cancel discards it", async () => {
    setup();
    await userEvent.type(delta(), "1001");
    await userEvent.type(note(), "promo");
    await apply();
    const dlg = confirm("Grant a large amount");
    expect(dlg.getByText("+1,001")).toBeInTheDocument();
    await userEvent.click(dlg.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Grant a large amount" })).toBeNull();
    expect(mockApi.callsTo("POST", "/v1/admin/users/u1/coins")).toHaveLength(0);
  });

  it("a delta of exactly the threshold is applied without confirmation", async () => {
    mockApi.post("/v1/admin/users/u1/coins", { ...(user() as object), coin_balance: 1500 });
    setup();
    await userEvent.type(delta(), "1000");
    await userEvent.type(note(), "promo");
    await apply();
    expect(await screen.findByText(/Granted 1,000 coins/)).toBeInTheDocument();
  });

  it("reports an adjustment failure and keeps the form values", async () => {
    mockApi.post("/v1/admin/users/u1/coins", fail(422, "insufficient"));
    const { onUpdated } = setup();
    await userEvent.type(delta(), "10");
    await userEvent.type(note(), "test");
    await apply();
    expect(await screen.findByText("insufficient")).toBeInTheDocument();
    expect(onUpdated).not.toHaveBeenCalled();
    expect(delta()).toHaveValue("10");
  });
});

describe("UserDrawer VIP", () => {
  const days = () => screen.getByLabelText(/^Days/);
  const grant = () => userEvent.click(within(screen.getByText("Grant VIP", { selector: "h3" }).closest("form") as HTMLFormElement).getByRole("button", { name: "Grant" }));

  it("validates the number of days", async () => {
    setup();
    await userEvent.clear(days());
    await userEvent.type(days(), "0");
    await grant();
    expect(screen.getByText("Days must be a whole number between 1 and 3650.")).toBeInTheDocument();
    await userEvent.clear(days());
    await userEvent.type(days(), "4000");
    await grant();
    expect(screen.getByText("Days must be a whole number between 1 and 3650.")).toBeInTheDocument();
    await userEvent.clear(days());
    await userEvent.type(days(), "2.5");
    await grant();
    expect(screen.getByText("Days must be a whole number between 1 and 3650.")).toBeInTheDocument();
    await userEvent.type(days(), "1");
    expect(screen.queryByText(/Days must be/)).toBeNull();
    expect(mockApi.callsTo("POST", "/v1/admin/users/u1/vip")).toHaveLength(0);
  });

  it("confirms, grants, and refreshes the VIP line", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2030-03-01T00:00:00Z"));
    mockApi.post("/v1/admin/users/u1/vip", { ok: true });
    setup();
    await screen.findByText("No active VIP.");
    fireEvent.change(days(), { target: { value: "10" } });
    await userEvent.type(screen.getByLabelText("Note"), "  loyalty ");
    await grant();
    const dlg = confirm("Grant VIP");
    expect(dlg.getByText("10 days")).toBeInTheDocument();
    expect(dlg.getByText(/Mar 2030/)).toBeInTheDocument();
    expect(dlg.getByText("loyalty")).toBeInTheDocument();
    expect(dlg.getByText("500 (unchanged)")).toBeInTheDocument();
    mockApi.get("/v1/admin/users/u1", detail({ is_vip: true, vip_ends_at: "2030-03-11T00:00:00Z" }));
    await userEvent.click(dlg.getByRole("button", { name: "Grant VIP" }));
    expect(await screen.findByText("VIP granted for 10 days")).toBeInTheDocument();
    expect(mockApi.callsTo("POST", "/v1/admin/users/u1/vip")[0].body).toEqual({ days: 10, note: "loyalty" });
    expect(await screen.findByText(/Active until 11 Mar 2030/)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("sends a null note when blank, and omits the note row in the confirmation", async () => {
    mockApi.post("/v1/admin/users/u1/vip", { ok: true });
    setup();
    await grant();
    const dlg = confirm("Grant VIP");
    expect(dlg.getByText("30 days")).toBeInTheDocument();
    expect(dlg.queryByText("Note")).toBeNull();
    await userEvent.click(dlg.getByRole("button", { name: "Grant VIP" }));
    await screen.findByText("VIP granted for 30 days");
    expect(mockApi.callsTo("POST", "/v1/admin/users/u1/vip")[0].body).toEqual({ days: 30, note: null });
  });

  it("cancel discards the pending grant; failure is reported", async () => {
    mockApi.post("/v1/admin/users/u1/vip", fail(500, "vip down"));
    setup();
    await grant();
    await userEvent.click(confirm("Grant VIP").getByRole("button", { name: "Cancel" }));
    expect(mockApi.callsTo("POST", "/v1/admin/users/u1/vip")).toHaveLength(0);
    await grant();
    await userEvent.click(confirm("Grant VIP").getByRole("button", { name: "Grant VIP" }));
    expect(await screen.findByText("vip down")).toBeInTheDocument();
  });
});

describe("UserDrawer without a display name", () => {
  it("names the user by public id in the coin and VIP confirmations", async () => {
    setup(user({ display_name: null }));
    await userEvent.type(screen.getByLabelText(/^Delta/), "-5");
    await userEvent.type(screen.getByLabelText(/^Note\s*\*/), "fraud");
    await userEvent.click(within(screen.getByText("Adjust coins").closest("form") as HTMLFormElement).getByRole("button", { name: "Apply" }));
    expect(confirm("Remove coins").getByText("KU-123")).toBeInTheDocument();
    await userEvent.click(confirm("Remove coins").getByRole("button", { name: "Cancel" }));
    await userEvent.click(within(screen.getByText("Grant VIP", { selector: "h3" }).closest("form") as HTMLFormElement).getByRole("button", { name: "Grant" }));
    expect(confirm("Grant VIP").getByText("KU-123")).toBeInTheDocument();
  });
});

describe("UserDrawer chrome", () => {
  it("closes through the dialog close button", async () => {
    const { onClose } = setup();
    await userEvent.click(within(screen.getByRole("dialog", { name: "Asha" })).getAllByRole("button", { name: "Close" })[0]);
    expect(onClose).toHaveBeenCalled();
  });
});
