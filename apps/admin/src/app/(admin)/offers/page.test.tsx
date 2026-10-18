import "@/test/dom-matchers-pages";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderPage } from "@/test/render";
import { installDialog } from "@/test/dialog-pages";
import { fail, mockApi } from "@/test/api";
import Page from "./page";

// `call` always rejects with an Error; the page still guards against other throwables, so exercise that guard.
vi.mock("@/lib/api", async (orig) => {
  const real = await orig<typeof import("@/lib/api")>();
  return { ...real, call: vi.fn(real.call) };
});
import { call } from "@/lib/api";

beforeAll(installDialog);

const PACKS = [
  { id: "pack-1111-aaaa", name: "Starter", sku: "st", is_active: true },
  { id: "pack-2222-bbbb", name: "Whale", sku: "wh", is_active: false },
];
const O = (over: Record<string, unknown> = {}) => ({
  id: "o1",
  title: "Welcome deal",
  kind: "first_purchase",
  pack_id: "pack-1111-aaaa",
  discount_pct: 20,
  eligibility: null,
  starts_at: null,
  ends_at: null,
  is_active: true,
  coupons: [],
  ...over,
});
const C = (over: Record<string, unknown> = {}) => ({ id: "c1", code: "WELCOME", used: 0, max_uses: null, ...over });

function setup(offers: unknown[], packs: unknown[] | Record<string, unknown> = PACKS) {
  mockApi.get("/v1/admin/offers", offers);
  mockApi.get("/v1/admin/packs", packs);
  return renderPage(<Page />);
}

describe("OffersPage list", () => {
  it("renders windows, kinds, pack names, coupons and eligibility", async () => {
    const future = new Date(Date.now() + 86400e3 * 400).toISOString();
    const past = new Date(Date.now() - 86400e3 * 400).toISOString();
    setup([
      O({ eligibility: { countries: ["IN"] }, coupons: [C({ used: 2 }), C({ id: "c2", code: "TWO", used: 1 })] }),
      O({ id: "o2", title: "Soon", kind: "coupon", pack_id: null, discount_pct: null, starts_at: future, coupons: [C({ id: "c3", code: "ONE" })] }),
      O({ id: "o3", title: "Gone", kind: "winback", ends_at: past, pack_id: "zzzzzzzzzzzzz" }),
      O({ id: "o4", title: "Off", kind: "bundle", is_active: false, eligibility: {} }),
      O({ id: "o5", title: "Odd", kind: "mystery" }),
    ]);
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(await screen.findByText("Welcome deal")).toBeInTheDocument();
    expect(screen.getByText('{"countries":["IN"]}')).toBeInTheDocument();
    expect(screen.getByText("2 codes · 3 used")).toBeInTheDocument();
    expect(screen.getByText("1 code · 0 used")).toBeInTheDocument();
    expect(screen.getAllByText("Starter").length).toBeGreaterThan(0);
    expect(screen.getByText("zzzzzzzz…")).toBeInTheDocument();
    expect(screen.getByText("any")).toBeInTheDocument();
    expect(screen.getByText("scheduled")).toBeInTheDocument();
    expect(screen.getByText("expired")).toBeInTheDocument();
    expect(screen.getByText("inactive")).toBeInTheDocument();
    expect(screen.getAllByText("live").length).toBeGreaterThan(0);
    expect(screen.getByText("First purchase")).toBeInTheDocument();
    expect(screen.getByText("mystery")).toBeInTheDocument();
    expect(screen.getAllByText("always").length).toBeGreaterThan(0);
    expect(screen.getAllByText("20%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("none").length).toBeGreaterThan(0);
  });
  it("shows range when only one bound is set", async () => {
    setup([O({ starts_at: "2020-01-01T00:00:00Z" })]);
    expect(await screen.findByText(/→/)).toBeInTheDocument();
  });
  it("empty and error states", async () => {
    setup([]);
    expect(await screen.findByText("No offers")).toBeInTheDocument();
  });
  it("error retry", async () => {
    mockApi.get("/v1/admin/packs", PACKS);
    mockApi.get("/v1/admin/offers", () => fail(500, "bad gateway"));
    renderPage(<Page />);
    expect(await screen.findByText("bad gateway")).toBeInTheDocument();
    mockApi.get("/v1/admin/offers", [O()]);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Welcome deal")).toBeInTheDocument();
  });
});

describe("OffersPage activate / deactivate", () => {
  it("deactivates after confirmation", async () => {
    setup([O()]);
    mockApi.put("/v1/admin/offers/o1", (c) => O(c.body));
    await userEvent.click(await screen.findByRole("button", { name: "Deactivate" }));
    const dlg = screen.getByRole("dialog", { name: "Deactivate offer" });
    expect(dlg).toHaveTextContent("Welcome deal");
    await userEvent.click(within(dlg).getByRole("button", { name: "Deactivate" }));
    expect(await screen.findByText("Offer deactivated")).toBeInTheDocument();
    expect(mockApi.callsTo("PUT", "/v1/admin/offers/o1")[0].body).toEqual({
      title: "Welcome deal", kind: "first_purchase", pack_id: "pack-1111-aaaa", discount_pct: 20, eligibility: null, starts_at: null, ends_at: null, is_active: false,
    });
    expect(await screen.findByRole("button", { name: "Activate" })).toBeInTheDocument();
  });
  it("cancel deactivation", async () => {
    setup([O()]);
    await userEvent.click(await screen.findByRole("button", { name: "Deactivate" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(mockApi.callsTo("PUT")).toHaveLength(0);
  });
  it("activates immediately; failure toasts", async () => {
    setup([O({ is_active: false, pack_id: null, discount_pct: null, eligibility: { x: 1 }, starts_at: "2020-01-01T00:00:00Z", ends_at: "2099-01-01T00:00:00Z" })]);
    mockApi.put("/v1/admin/offers/o1", () => fail(409, "locked"));
    await userEvent.click(await screen.findByRole("button", { name: "Activate" }));
    expect(await screen.findByText("locked")).toBeInTheDocument();
    mockApi.put("/v1/admin/offers/o1", (c) => O(c.body));
    await userEvent.click(screen.getByRole("button", { name: "Activate" }));
    expect(await screen.findByText("Offer activated")).toBeInTheDocument();
    expect(mockApi.callsTo("PUT").at(-1)!.body).toMatchObject({ is_active: true, pack_id: null, eligibility: { x: 1 }, ends_at: "2099-01-01T00:00:00Z" });
  });
  it("non-Error failure", async () => {
    setup([O({ is_active: false })]);
    await userEvent.click(await screen.findByRole("button", { name: "Activate" }));
    vi.mocked(call).mockImplementationOnce((() => Promise.reject(1)) as typeof call);
    await userEvent.click(screen.getByRole("button", { name: "Activate" }));
    expect(await screen.findByText("Update failed")).toBeInTheDocument();
  });
});

describe("OfferDialog", () => {
  const openNew = async () => {
    await userEvent.click(await screen.findByRole("button", { name: /New offer/ }));
    return screen.getByRole("dialog", { name: "New offer" });
  };

  it("validates every field", async () => {
    setup([]);
    mockApi.post("/v1/admin/offers", (c) => O(c.body));
    const dlg = await openNew();
    const submit = () => userEvent.click(within(dlg).getByRole("button", { name: "Create" }));
    await userEvent.type(within(dlg).getByLabelText("Discount %"), "95");
    fireEvent.change(within(dlg).getByLabelText("Starts at"), { target: { value: "2026-05-02T10:00" } });
    fireEvent.change(within(dlg).getByLabelText("Ends at"), { target: { value: "2026-05-01T10:00" } });
    fireEvent.change(within(dlg).getByRole("textbox", { name: /Other rules/ }), { target: { value: "{bad" } });
    await submit();
    expect(within(dlg).getByText("Title is required.")).toBeInTheDocument();
    expect(within(dlg).getByText("Whole number from 1 to 90, or blank.")).toBeInTheDocument();
    expect(within(dlg).getByText("End must be after start.")).toBeInTheDocument();
    expect(within(dlg).getAllByText(/Invalid JSON/).length).toBeGreaterThan(0);

    // countries and inactive days errors (override JSON error)
    fireEvent.change(within(dlg).getByRole("textbox", { name: /Other rules/ }), { target: { value: "" } });
    const chips = within(dlg).getByLabelText("Countries");
    await userEvent.type(chips, "india{Enter}");
    await submit();
    expect(within(dlg).getAllByText("“INDIA” is not a 2-letter ISO country code.").length).toBeGreaterThan(0);
    await userEvent.click(within(dlg).getByRole("button", { name: "Remove INDIA" }));
    await userEvent.type(within(dlg).getByLabelText("Inactive for (days)"), "0");
    await submit();
    expect(within(dlg).getAllByText("Inactive days must be a whole number of 1 or more.").length).toBeGreaterThan(0);
    expect(mockApi.callsTo("POST")).toHaveLength(0);
    // editing clears
    await userEvent.type(within(dlg).getByLabelText(/^Title/), "x");
    expect(within(dlg).queryByText("Title is required.")).toBeNull();
    fireEvent.change(within(dlg).getByLabelText("Ends at"), { target: { value: "2026-05-03T10:00" } });
    expect(within(dlg).queryByText("End must be after start.")).toBeNull();
    await userEvent.clear(within(dlg).getByLabelText("Discount %"));
    await userEvent.type(within(dlg).getByLabelText("Discount %"), "5");
    expect(within(dlg).queryByText("Whole number from 1 to 90, or blank.")).toBeNull();
  });

  it("creates a first_purchase offer with merged eligibility", async () => {
    setup([O({ id: "old", title: "Old" })]);
    mockApi.post("/v1/admin/offers", (c) => O({ ...c.body, id: "new1" }));
    const dlg = await openNew();
    await userEvent.type(within(dlg).getByLabelText(/^Title/), "  Fresh  ");
    await userEvent.selectOptions(within(dlg).getByLabelText("Pack"), "pack-2222-bbbb");
    expect(within(dlg).getByRole("option", { name: "Whale (wh) · inactive" })).toBeInTheDocument();
    await userEvent.type(within(dlg).getByLabelText("Discount %"), "15");
    fireEvent.change(within(dlg).getByLabelText("Starts at"), { target: { value: "2026-05-01T10:00" } });
    const chips = within(dlg).getByLabelText("Countries");
    await userEvent.type(chips, "in,us{Enter}in{Enter}");
    await userEvent.type(chips, "{Backspace}");
    await userEvent.type(within(dlg).getByLabelText("Inactive for (days)"), "30");
    fireEvent.change(within(dlg).getByRole("textbox", { name: /Other rules/ }), { target: { value: '{"vip":true}' } });
    await userEvent.click(within(dlg).getByRole("switch", { name: /Active/ }));
    await userEvent.click(within(dlg).getByRole("button", { name: "Create" }));
    expect(await screen.findByText("Offer created")).toBeInTheDocument();
    const body = mockApi.callsTo("POST", "/v1/admin/offers")[0].body;
    expect(body).toMatchObject({
      title: "Fresh",
      kind: "first_purchase",
      pack_id: "pack-2222-bbbb",
      discount_pct: 15,
      ends_at: null,
      is_active: false,
      eligibility: { vip: true, countries: ["IN", "US"], inactive_days: 30, first_purchase: true },
    });
    expect(body.starts_at).toBe(new Date("2026-05-01T10:00").toISOString());
    // new offer is prepended
    const titles = screen.getAllByText(/^(Fresh|Old)$/).map((n) => n.textContent);
    expect(titles).toEqual(["Fresh", "Old"]);
  });

  it("non-first-purchase kind with no eligibility sends null and null pack/discount; explicit first_purchase respected", async () => {
    setup([]);
    mockApi.post("/v1/admin/offers", (c) => O(c.body));
    const dlg = await openNew();
    await userEvent.type(within(dlg).getByLabelText(/^Title/), "Bundle");
    await userEvent.selectOptions(within(dlg).getByLabelText("Kind"), "bundle");
    await userEvent.click(within(dlg).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(mockApi.callsTo("POST")).toHaveLength(1));
    expect(mockApi.callsTo("POST")[0].body).toMatchObject({ kind: "bundle", pack_id: null, discount_pct: null, eligibility: null });
  });

  it("explicit first_purchase=false is kept", async () => {
    setup([]);
    mockApi.post("/v1/admin/offers", (c) => O(c.body));
    const dlg = await openNew();
    await userEvent.type(within(dlg).getByLabelText(/^Title/), "FP");
    fireEvent.change(within(dlg).getByRole("textbox", { name: /Other rules/ }), { target: { value: '{"first_purchase":false}' } });
    await userEvent.click(within(dlg).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(mockApi.callsTo("POST")).toHaveLength(1));
    expect(mockApi.callsTo("POST")[0].body.eligibility).toEqual({ first_purchase: false });
  });

  it("server error toasts and keeps the dialog open; non-Error fallback", async () => {
    setup([]);
    mockApi.post("/v1/admin/offers", () => fail(500, "explode"));
    const dlg = await openNew();
    await userEvent.type(within(dlg).getByLabelText(/^Title/), "T");
    await userEvent.click(within(dlg).getByRole("button", { name: "Create" }));
    expect(await screen.findByText("explode")).toBeInTheDocument();
    vi.mocked(call).mockImplementationOnce((() => Promise.reject(null)) as typeof call);
    await userEvent.click(within(dlg).getByRole("button", { name: "Create" }));
    expect(await screen.findByText("Save failed")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "New offer" })).toBeInTheDocument();
  });

  it("edits, prefilling eligibility parts and window; packs load failure hint", async () => {
    mockApi.get("/v1/admin/offers", [
      O({
        eligibility: { countries: ["IN", 5, "US"], inactive_days: 14, tier: "gold" },
        starts_at: "2026-01-01T09:30:00Z",
        ends_at: "2026-02-01T09:30:00Z",
        kind: "winback",
      }),
    ]);
    mockApi.get("/v1/admin/packs", () => fail(500, "packs down"));
    mockApi.put("/v1/admin/offers/o1", (c) => O(c.body));
    renderPage(<Page />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const dlg = screen.getByRole("dialog", { name: "Edit Welcome deal" });
    await waitFor(() => expect(dlg).toHaveTextContent("Packs failed to load: packs down"));
    expect(within(dlg).getByLabelText("Kind")).toHaveValue("winback");
    expect(within(dlg).getByLabelText("Inactive for (days)")).toHaveValue(14);
    expect(within(dlg).getByLabelText("Starts at")).toHaveValue(
      (() => {
        const d = new Date("2026-01-01T09:30:00Z");
        const p = (n: number) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
      })(),
    );
    expect(dlg).toHaveTextContent("IN");
    expect(dlg).toHaveTextContent("US");
    expect((within(dlg).getByRole("textbox", { name: /Other rules/ }) as HTMLTextAreaElement).value).toBe('{\n  "tier": "gold"\n}');
    await userEvent.click(within(dlg).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Offer saved")).toBeInTheDocument();
    expect(mockApi.callsTo("PUT")[0].body.eligibility).toEqual({ tier: "gold", countries: ["IN", "US"], inactive_days: 14 });
  });

  it("cancel closes", async () => {
    setup([]);
    const dlg = await openNew();
    await userEvent.click(within(dlg).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("CouponsDrawer", () => {
  const openDrawer = async (offers: unknown[]) => {
    setup(offers);
    await userEvent.click((await screen.findAllByRole("button", { name: /Coupons/ }))[0]);
    return screen.getByRole("dialog", { name: "Coupons · Welcome deal" });
  };
  it("empty state, validation, add, and list sync", async () => {
    const dlg = await openDrawer([O()]);
    expect(within(dlg).getByText("No coupons yet")).toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole("button", { name: /Add/ }));
    expect(within(dlg).getByText("4–32 uppercase letters or digits.")).toBeInTheDocument();
    await userEvent.type(within(dlg).getByLabelText(/^Code/), "ab");
    expect(within(dlg).queryByText("4–32 uppercase letters or digits.")).toBeNull();
    expect(within(dlg).getByLabelText(/^Code/)).toHaveValue("AB");
    await userEvent.type(within(dlg).getByLabelText(/^Code/), "CD");
    await userEvent.type(within(dlg).getByLabelText("Max uses"), "0");
    await userEvent.click(within(dlg).getByRole("button", { name: /Add/ }));
    expect(within(dlg).getByText(/Whole number of 1 or more/)).toBeInTheDocument();
    await userEvent.clear(within(dlg).getByLabelText("Max uses"));
    await userEvent.type(within(dlg).getByLabelText("Max uses"), "3");
    expect(within(dlg).queryByText(/Whole number of 1 or more/)).toBeNull();
    mockApi.post("/v1/admin/offers/o1/coupons", (c) => C({ id: "cx", code: c.body.code, max_uses: c.body.max_uses }));
    await userEvent.click(within(dlg).getByRole("button", { name: /Add/ }));
    expect(await screen.findByText("Coupon ABCD added")).toBeInTheDocument();
    expect(mockApi.callsTo("POST", "/v1/admin/offers/o1/coupons")[0].body).toEqual({ code: "ABCD", max_uses: 3 });
    expect(within(dlg).getByText("ABCD")).toBeInTheDocument();
    expect(within(dlg).getByLabelText(/^Code/)).toHaveValue("");
    // background list reflects it
    expect(screen.getAllByText("1 code · 0 used").length).toBeGreaterThan(0);
    // duplicate
    await userEvent.type(within(dlg).getByLabelText(/^Code/), "abcd");
    await userEvent.click(within(dlg).getByRole("button", { name: /Add/ }));
    expect(within(dlg).getByText("This offer already has that code.")).toBeInTheDocument();
  });
  it("unlimited max uses sent as null; server code error goes to field; other error toasts", async () => {
    const dlg = await openDrawer([O()]);
    await userEvent.type(within(dlg).getByLabelText(/^Code/), "FREE20");
    mockApi.post("/v1/admin/offers/o1/coupons", () => fail(409, "Code already used elsewhere"));
    await userEvent.click(within(dlg).getByRole("button", { name: /Add/ }));
    await waitFor(() => expect(within(dlg).getByText("Code already used elsewhere")).toBeInTheDocument());
    expect(mockApi.callsTo("POST")[0].body).toEqual({ code: "FREE20", max_uses: null });
    mockApi.post("/v1/admin/offers/o1/coupons", () => fail(500, "boom"));
    await userEvent.click(within(dlg).getByRole("button", { name: /Add/ }));
    expect(await screen.findByText("boom")).toBeInTheDocument();
    vi.mocked(call).mockImplementationOnce((() => Promise.reject(2)) as typeof call);
    await userEvent.click(within(dlg).getByRole("button", { name: /Add/ }));
    expect(await screen.findByText("Add failed")).toBeInTheDocument();
  });
  it("deletes coupons: used message, unused message, failure", async () => {
    let dlg = await openDrawer([O({ coupons: [C({ used: 5, max_uses: 5 }), C({ id: "c2", code: "NEW", used: 0, max_uses: null })] })]);
    expect(within(dlg).getByText("exhausted")).toBeInTheDocument();
    expect(within(dlg).getByText("∞")).toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole("button", { name: "Delete WELCOME" }));
    const confirm = screen.getByRole("dialog", { name: "Delete coupon" });
    expect(confirm).toHaveTextContent("used 5 time(s)");
    mockApi.delete("/v1/admin/coupons/c1", () => fail(500, "cannot"));
    await userEvent.click(within(confirm).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("cannot")).toBeInTheDocument();
    mockApi.delete("/v1/admin/coupons/c1", undefined);
    await userEvent.click(within(confirm).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Deleted WELCOME")).toBeInTheDocument();
    // (Closing the nested confirm dialog also fires the drawer's onClose through React's tree, so reopen it.)
    await userEvent.click(screen.getAllByRole("button", { name: /Coupons/ })[0]);
    expect(within(screen.getByRole("dialog", { name: "Coupons · Welcome deal" })).queryByText("WELCOME")).toBeNull();
    dlg = screen.getByRole("dialog", { name: "Coupons · Welcome deal" });

    await userEvent.click(within(dlg).getByRole("button", { name: "Delete NEW" }));
    expect(screen.getByRole("dialog", { name: "Delete coupon" })).toHaveTextContent("has not been used yet");
    vi.mocked(call).mockImplementationOnce((() => Promise.reject(3)) as typeof call);
    await userEvent.click(within(screen.getByRole("dialog", { name: "Delete coupon" })).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Delete failed")).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole("dialog", { name: "Delete coupon" })).getByRole("button", { name: "Cancel" }));
  });
  it("closes", async () => {
    const dlg = await openDrawer([O()]);
    await userEvent.click(within(dlg).getAllByRole("button", { name: "Close" })[0]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
