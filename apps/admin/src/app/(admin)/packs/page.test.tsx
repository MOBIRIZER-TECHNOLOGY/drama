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

const P = (over: Record<string, unknown> = {}) => ({
  id: "k1",
  sku: "coins_100",
  name: "Hundred",
  description: null,
  kind: "coins",
  coins: 100,
  bonus_coins: 0,
  duration_days: null,
  google_product_id: null,
  apple_product_id: null,
  is_active: true,
  sort_order: 0,
  badge: null,
  prices: [{ currency: "INR", country: "*", amount: 99 }],
  ...over,
});

function setup(packs: unknown[], episodePrice: unknown = 10) {
  mockApi.get("/v1/admin/packs", packs);
  mockApi.get("/v1/admin/settings/economy", episodePrice === undefined ? {} : { episode_price: episodePrice });
  return renderPage(<Page />);
}

describe("PacksPage list", () => {
  it("renders sorted rows with badges, bonus, prices, store ids and per-episode value", async () => {
    setup([
      P({ id: "b", name: "Big", sku: "big", coins: 500, bonus_coins: 100, sort_order: 2, badge: "Best value", google_product_id: "g.big", apple_product_id: "a.big", prices: [{ currency: "INR", country: "IN", amount: 299 }, { currency: "USD", country: "*", amount: 5 }] }),
      P({ id: "a", name: "Small", sku: "small", coins: 100, sort_order: 1, prices: [{ currency: "INR", country: "*", amount: 49 }] }),
      P({ id: "v", name: "Pass", sku: "vip", kind: "vip", duration_days: 30, coins: 0, sort_order: 3, prices: [{ currency: "INR", country: "*", amount: 299 }] }),
      P({ id: "t", name: "Tiny", sku: "tiny", coins: 5, sort_order: 4, prices: [] }),
      P({ id: "n", name: "Free", sku: "free", coins: 0, sort_order: 4, is_active: false, prices: [], google_product_id: "g.only" }),
    ]);
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    await screen.findByText("Big");
    const names = screen.getAllByRole("row").slice(1).map((r) => r.querySelector("td")!.textContent);
    expect(names[0]).toContain("Small");
    expect(names[1]).toContain("Big");
    expect(names[2]).toContain("Pass");
    expect(screen.getByText("Best value")).toBeInTheDocument();
    expect(screen.getByText("+100")).toBeInTheDocument();
    expect(screen.getByText("INR 299 (IN)")).toBeInTheDocument();
    expect(screen.getByText("USD 5")).toBeInTheDocument();
    expect(screen.getByText("G: g.big")).toBeInTheDocument();
    expect(screen.getByText("A: a.big")).toBeInTheDocument();
    expect(screen.getByText("G: g.only")).toBeInTheDocument();
    expect(screen.getByText(/vip · 30d/)).toBeInTheDocument();
    // economics: Small => 10 episodes at 49 => 4.90 / episode
    expect(screen.getByText(/10 episodes/)).toBeInTheDocument();
    expect(screen.getByText(/\+20% bonus/)).toBeInTheDocument();
    // warnings: no price on an active pack, VIP undercutting, plus an inverted ladder
    expect(screen.getByText(/Active with no price/)).toBeInTheDocument();
    expect(screen.getAllByText("none").length).toBe(2);
  });
  it("singular episode and no economics when the episode price is unset", async () => {
    setup([P({ coins: 10, prices: [{ currency: "INR", country: "*", amount: 10 }] })]);
    expect(await screen.findByText(/1 episode$/)).toBeInTheDocument();
  });
  it("dash when nothing to say", async () => {
    setup([P()], undefined);
    await screen.findByText("Hundred");
    await waitFor(() => expect(screen.getAllByText("—").length).toBeGreaterThan(0));
    expect(screen.queryByText(/ \/ episode/)).toBeNull();
  });
  it("inverted ladder warning", async () => {
    setup([
      P({ id: "s", name: "Small", sku: "s", coins: 100, prices: [{ currency: "INR", country: "*", amount: 50 }] }),
      P({ id: "l", name: "Large", sku: "l", coins: 200, prices: [{ currency: "INR", country: "*", amount: 200 }] }),
    ]);
    expect(await screen.findByText(/Worse value than Small/)).toBeInTheDocument();
  });
  it("VIP undercutting a pack is flagged", async () => {
    setup([
      P({ id: "l", name: "Large", sku: "l", coins: 100, prices: [{ currency: "INR", country: "*", amount: 500 }] }),
      P({ id: "v", name: "Pass", sku: "vip", kind: "vip", duration_days: 30, coins: 0, sort_order: 3, prices: [{ currency: "INR", country: "*", amount: 299 }] }),
    ]);
    expect(await screen.findByText("Pass costs less and unlocks everything, so this pack is dominated by it.")).toBeInTheDocument();
  });
  it("empty state", async () => {
    setup([]);
    expect(await screen.findByText("No packs")).toBeInTheDocument();
  });
  it("error retry", async () => {
    mockApi.get("/v1/admin/packs", () => fail(500, "no packs"));
    mockApi.get("/v1/admin/settings/economy", {});
    renderPage(<Page />);
    expect(await screen.findByText("no packs")).toBeInTheDocument();
    mockApi.get("/v1/admin/packs", [P()]);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Hundred")).toBeInTheDocument();
  });
});

describe("PacksPage toggle and delete", () => {
  it("deactivates after confirm using the full body", async () => {
    setup([P({ description: "d", badge: "hot", google_product_id: "g" })]);
    mockApi.put("/v1/admin/packs/k1", (c) => P(c.body));
    await userEvent.click(await screen.findByRole("switch", { name: "Hundred active" }));
    const dlg = screen.getByRole("dialog", { name: "Deactivate pack" });
    expect(dlg).toHaveTextContent("Take “Hundred” off the store?");
    await userEvent.click(within(dlg).getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false"));
    expect(mockApi.callsTo("PUT", "/v1/admin/packs/k1")[0].body).toEqual({
      sku: "coins_100", name: "Hundred", description: "d", kind: "coins", coins: 100, bonus_coins: 0, duration_days: null,
      google_product_id: "g", apple_product_id: null, is_active: false, sort_order: 0, badge: "hot",
      prices: [{ currency: "INR", country: "*", amount: 99 }],
    });
  });
  it("activation message; cancel; and rollback on failure", async () => {
    setup([P({ is_active: false })]);
    await userEvent.click(await screen.findByRole("switch"));
    let dlg = screen.getByRole("dialog", { name: "Activate pack" });
    expect(dlg).toHaveTextContent("Put “Hundred” on the store?");
    await userEvent.click(within(dlg).getByRole("button", { name: "Cancel" }));
    expect(mockApi.callsTo("PUT")).toHaveLength(0);
    mockApi.put("/v1/admin/packs/k1", () => fail(500, "store said no"));
    await userEvent.click(screen.getByRole("switch"));
    dlg = screen.getByRole("dialog", { name: "Activate pack" });
    await userEvent.click(within(dlg).getByRole("button", { name: "Activate" }));
    expect(await screen.findByText("store said no")).toBeInTheDocument();
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });
  it("non-Error toggle and delete failures use generic text", async () => {
    setup([P()]);
    await userEvent.click(await screen.findByRole("switch"));
    vi.mocked(call).mockImplementationOnce((() => Promise.reject(1)) as typeof call);
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Deactivate" }));
    expect(await screen.findByText("Update failed")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete Hundred" }));
    vi.mocked(call).mockImplementationOnce((() => Promise.reject(1)) as typeof call);
    await userEvent.click(within(screen.getByRole("dialog", { name: "Delete pack" })).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Delete failed")).toBeInTheDocument();
  });
  it("deletes and removes the row", async () => {
    setup([P(), P({ id: "k2", name: "Other", sku: "o" })]);
    mockApi.delete("/v1/admin/packs/k1", undefined);
    await userEvent.click(await screen.findByRole("button", { name: "Delete Hundred" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "Delete pack" })).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Deleted “Hundred”")).toBeInTheDocument();
    expect(screen.queryByText("coins_100")).toBeNull();
    expect(screen.getByText("Other")).toBeInTheDocument();
  });
  it("delete failure keeps row; cancel works", async () => {
    setup([P()]);
    mockApi.delete("/v1/admin/packs/k1", () => fail(409, "in use"));
    await userEvent.click(await screen.findByRole("button", { name: "Delete Hundred" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("in use")).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("coins_100")).toBeInTheDocument();
  });
});

describe("PackDialog", () => {
  const openNew = async () => {
    await userEvent.click(await screen.findByRole("button", { name: /New pack/ }));
    return screen.getByRole("dialog", { name: "New pack" });
  };
  it("validates name, SKU and price rows", async () => {
    setup([]);
    mockApi.post("/v1/admin/packs", (c) => P(c.body));
    const dlg = await openNew();
    const submit = () => userEvent.click(within(dlg).getByRole("button", { name: "Create" }));
    await userEvent.type(within(dlg).getByLabelText("Amount"), "5");
    await userEvent.clear(within(dlg).getByLabelText("Currency"));
    await userEvent.type(within(dlg).getByLabelText("Currency"), "in");
    await submit();
    expect(within(dlg).getByText("Name is required.")).toBeInTheDocument();
    expect(within(dlg).getByText("SKU is required.")).toBeInTheDocument();
    expect(within(dlg).getByText("Row 1: currency must be a 3-letter code.")).toBeInTheDocument();
    expect(within(dlg).getByLabelText("Currency")).toHaveAttribute("aria-invalid", "true");
    await userEvent.type(within(dlg).getByLabelText("Currency"), "r");
    expect(within(dlg).queryByText(/currency must be/)).toBeNull();
    await userEvent.clear(within(dlg).getByLabelText("Amount"));
    await submit();
    expect(within(dlg).getByText("Row 1: amount must be a number of 0 or more.")).toBeInTheDocument();
    await userEvent.type(within(dlg).getByLabelText("Amount"), "5");
    await userEvent.clear(within(dlg).getByLabelText("Country"));
    await userEvent.type(within(dlg).getByLabelText("Country"), "i");
    await submit();
    expect(within(dlg).getByText("Row 1: country must be a 2-letter code or *.")).toBeInTheDocument();
    await userEvent.type(within(dlg).getByLabelText(/^Name/), "N");
    expect(within(dlg).queryByText("Name is required.")).toBeNull();
    await userEvent.type(within(dlg).getByLabelText(/^SKU/), "S");
    expect(within(dlg).queryByText("SKU is required.")).toBeNull();
    expect(mockApi.callsTo("POST")).toHaveLength(0);
  });

  it("creates a coin pack, skipping blank price rows and trimming", async () => {
    setup([P({ id: "z", sort_order: 5 })]);
    mockApi.post("/v1/admin/packs", (c) => P({ ...c.body, id: "new" }));
    const dlg = await openNew();
    await userEvent.type(within(dlg).getByLabelText(/^Name/), " Gold ");
    await userEvent.type(within(dlg).getByLabelText(/^SKU/), "gold ");
    await userEvent.type(within(dlg).getByLabelText("Badge"), "Hot");
    const coins = within(dlg).getByLabelText("Coins");
    await userEvent.clear(coins);
    await userEvent.type(coins, "250");
    fireEvent.change(within(dlg).getByLabelText("Bonus coins"), { target: { value: "-5" } });
    await userEvent.type(within(dlg).getByLabelText("Sort order"), "3");
    await userEvent.type(within(dlg).getByLabelText("Google product ID"), " g1 ");
    await userEvent.type(within(dlg).getByLabelText("Apple product ID"), "a1");
    await userEvent.type(within(dlg).getByLabelText("Description"), "  desc ");
    await userEvent.type(within(dlg).getByLabelText("Amount"), "99.5");
    await userEvent.click(within(dlg).getByRole("button", { name: "Add price" }));
    await userEvent.click(within(dlg).getByRole("button", { name: "Add price" }));
    const countries = within(dlg).getAllByLabelText("Country");
    await userEvent.clear(countries[1]);
    await userEvent.type(within(dlg).getAllByLabelText("Currency")[1], "usd");
    await userEvent.type(within(dlg).getAllByLabelText("Amount")[1], "1.25");
    await userEvent.click(within(dlg).getAllByRole("button", { name: "Remove price" })[2]);
    expect(within(dlg).getAllByLabelText("Currency")).toHaveLength(2);
    await userEvent.type(within(dlg).getAllByLabelText("Country")[1], "us");
    await userEvent.click(within(dlg).getByRole("switch", { name: /Active/ }));
    await userEvent.click(within(dlg).getByRole("button", { name: "Create" }));
    expect(await screen.findByText("Pack created")).toBeInTheDocument();
    expect(mockApi.callsTo("POST", "/v1/admin/packs")[0].body).toEqual({
      sku: "gold", name: "Gold", description: "desc", kind: "coins", coins: 250, bonus_coins: 0, duration_days: null,
      google_product_id: "g1", apple_product_id: "a1", is_active: false, sort_order: 3, badge: "Hot",
      prices: [{ currency: "INR", country: "*", amount: 99.5 }, { currency: "USD", country: "US", amount: 1.25 }],
    });
    expect(await screen.findByText("Gold")).toBeInTheDocument();
  });

  it("VIP shows duration with validation; blank duration allowed", async () => {
    setup([]);
    mockApi.post("/v1/admin/packs", (c) => P(c.body));
    const dlg = await openNew();
    expect(within(dlg).queryByLabelText("Duration (days)")).toBeNull();
    await userEvent.click(within(dlg).getByRole("button", { name: "Remove price" }));
    await userEvent.selectOptions(within(dlg).getByLabelText("Kind"), "vip");
    await userEvent.type(within(dlg).getByLabelText(/^Name/), "VIP");
    await userEvent.type(within(dlg).getByLabelText(/^SKU/), "vip1");
    await userEvent.type(within(dlg).getByLabelText("Duration (days)"), "0");
    await userEvent.click(within(dlg).getByRole("button", { name: "Create" }));
    expect(within(dlg).getByText("Whole number of days, at least 1.")).toBeInTheDocument();
    await userEvent.clear(within(dlg).getByLabelText("Duration (days)"));
    await userEvent.type(within(dlg).getByLabelText("Duration (days)"), "30");
    expect(within(dlg).queryByText("Whole number of days, at least 1.")).toBeNull();
    await userEvent.click(within(dlg).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(mockApi.callsTo("POST")).toHaveLength(1));
    expect(mockApi.callsTo("POST")[0].body).toMatchObject({ kind: "vip", duration_days: 30, prices: [] });
  });

  it("empty blank duration is sent as null for VIP", async () => {
    setup([]);
    mockApi.post("/v1/admin/packs", (c) => P(c.body));
    const dlg = await openNew();
    await userEvent.click(within(dlg).getByRole("button", { name: "Remove price" }));
    await userEvent.selectOptions(within(dlg).getByLabelText("Kind"), "vip");
    await userEvent.type(within(dlg).getByLabelText(/^Name/), "V");
    await userEvent.type(within(dlg).getByLabelText(/^SKU/), "v");
    await userEvent.click(within(dlg).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(mockApi.callsTo("POST")).toHaveLength(1));
    expect(mockApi.callsTo("POST")[0].body.duration_days).toBeNull();
  });

  it("edit prefills (null country -> *), PUTs, and replaces the row", async () => {
    setup([P({ prices: [{ currency: "INR", country: null, amount: 10 }], google_product_id: "gg", description: "dd", badge: "b" })]);
    mockApi.put("/v1/admin/packs/k1", (c) => P({ ...c.body }));
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const dlg = screen.getByRole("dialog", { name: "Edit Hundred" });
    expect(within(dlg).getByLabelText("Country")).toHaveValue("*");
    expect(within(dlg).getByLabelText("Google product ID")).toHaveValue("gg");
    await userEvent.clear(within(dlg).getByLabelText(/^Name/));
    await userEvent.type(within(dlg).getByLabelText(/^Name/), "Renamed");
    await userEvent.click(within(dlg).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Pack saved")).toBeInTheDocument();
    expect(await screen.findByText("Renamed")).toBeInTheDocument();
    expect(mockApi.callsTo("PUT")[0].body.prices).toEqual([{ currency: "INR", country: "*", amount: 10 }]);
  });

  it("server error and non-Error toast; cancel closes", async () => {
    setup([]);
    mockApi.post("/v1/admin/packs", () => fail(409, "sku taken"));
    const dlg = await openNew();
    await userEvent.click(within(dlg).getByRole("button", { name: "Remove price" }));
    await userEvent.type(within(dlg).getByLabelText(/^Name/), "A");
    await userEvent.type(within(dlg).getByLabelText(/^SKU/), "a");
    await userEvent.click(within(dlg).getByRole("button", { name: "Create" }));
    expect(await screen.findByText("sku taken")).toBeInTheDocument();
    vi.mocked(call).mockImplementationOnce((() => Promise.reject(1)) as typeof call);
    await userEvent.click(within(dlg).getByRole("button", { name: "Create" }));
    expect(await screen.findByText("Save failed")).toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("price rows: stops at the first bad row, skips fully blank rows, defaults empty country to *, edits VIP durations", async () => {
    setup([
      P({ id: "k1", kind: "vip", duration_days: 30, coins: 0, sort_order: 1 }),
      P({ id: "k2", name: "Second", sku: "second", sort_order: 2 }),
    ]);
    mockApi.put("/v1/admin/packs/k1", (c) => P({ ...c.body, id: "k1" }));
    await userEvent.click((await screen.findAllByRole("button", { name: "Edit" }))[0]);
    const dlg = screen.getByRole("dialog", { name: "Edit Hundred" });
    expect(within(dlg).getByLabelText("Duration (days)")).toHaveValue(30);
    // row 2: blank (skipped); row 3: empty country (-> *); row 4 + 5: first bad row wins
    for (let i = 0; i < 4; i++) await userEvent.click(within(dlg).getByRole("button", { name: "Add price" }));
    const cur = () => within(dlg).getAllByLabelText("Currency");
    const amt = () => within(dlg).getAllByLabelText("Amount");
    const ctry = () => within(dlg).getAllByLabelText("Country");
    await userEvent.type(cur()[2], "eur");
    await userEvent.type(amt()[2], "3");
    await userEvent.clear(ctry()[2]);
    await userEvent.type(cur()[3], "x");
    await userEvent.type(amt()[3], "1");
    await userEvent.type(cur()[4], "y");
    await userEvent.type(amt()[4], "1");
    await userEvent.click(within(dlg).getByRole("button", { name: "Save" }));
    expect(within(dlg).getByText("Row 4: currency must be a 3-letter code.")).toBeInTheDocument();
    expect(cur()[3]).toHaveAttribute("aria-invalid", "true");
    expect(cur()[4]).not.toHaveAttribute("aria-invalid");
    await userEvent.click(within(dlg).getAllByRole("button", { name: "Remove price" })[4]);
    await userEvent.click(within(dlg).getAllByRole("button", { name: "Remove price" })[3]);
    await userEvent.click(within(dlg).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockApi.callsTo("PUT")).toHaveLength(1));
    expect(mockApi.callsTo("PUT")[0].body.prices).toEqual([
      { currency: "INR", country: "*", amount: 99 },
      { currency: "EUR", country: "*", amount: 3 },
    ]);
    expect(mockApi.callsTo("PUT")[0].body.duration_days).toBe(30);
    // other rows are left alone after a save replaces only the edited pack
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  it("non-numeric coin and sort values fall back to 0", async () => {
    setup([]);
    const dlg = await openNew();
    fireEvent.change(within(dlg).getByLabelText("Coins"), { target: { value: "50" } });
    expect(within(dlg).getByLabelText("Coins")).toHaveValue(50);
    fireEvent.change(within(dlg).getByLabelText("Coins"), { target: { value: "" } });
    expect(within(dlg).getByLabelText("Coins")).toHaveValue(0);
    fireEvent.change(within(dlg).getByLabelText("Bonus coins"), { target: { value: "7" } });
    fireEvent.change(within(dlg).getByLabelText("Bonus coins"), { target: { value: "" } });
    expect(within(dlg).getByLabelText("Bonus coins")).toHaveValue(0);
    fireEvent.change(within(dlg).getByLabelText("Sort order"), { target: { value: "4" } });
    fireEvent.change(within(dlg).getByLabelText("Sort order"), { target: { value: "" } });
    expect(within(dlg).getByLabelText("Sort order")).toHaveValue(0);
  });
});
