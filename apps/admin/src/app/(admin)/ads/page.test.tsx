import "@/test/dom-matchers-pages";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderPage } from "@/test/render";
import { installDialog } from "@/test/dialog-pages";
import { fail, mockApi } from "@/test/api";
import Page from "./page";

// `call` always rejects with an Error; the pages still guard against other throwables, so exercise that guard.
vi.mock("@/lib/api", async (orig) => {
  const real = await orig<typeof import("@/lib/api")>();
  return { ...real, call: vi.fn(real.call) };
});
import { call } from "@/lib/api";

beforeAll(installDialog);

const P = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  name: "Unlock rail",
  slot: "unlock_rewarded",
  provider: "admob",
  unit_id: "ca-app-1",
  platforms: ["android", "ios"],
  reward_coins: 5,
  frequency_cap_sec: 300,
  is_active: true,
  sort_order: 1,
  updated_at: "2026-01-02T03:04:05Z",
  ...over,
});
const list = (items: unknown[]) => ({ items, total: items.length, active: items.filter((i) => (i as { is_active: boolean }).is_active).length });

describe("AdsPage list", () => {
  it("shows loading then rows with summary", async () => {
    mockApi.get("/v1/admin/ad-placements", list([P(), P({ id: "p2", name: "Home", slot: "home_rail", provider: "meta", platforms: [], reward_coins: null, frequency_cap_sec: 0, is_active: false, updated_at: null })]));
    renderPage(<Page />);
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(await screen.findByText("Unlock rail")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1 of 2 placements live");
    expect(screen.getByText("5 coins")).toBeInTheDocument();
    expect(screen.getByText("300s")).toBeInTheDocument();
    expect(screen.getAllByText("none")).toHaveLength(2);
    expect(screen.getByText("Meta Audience Network")).toBeInTheDocument();
    expect(screen.getByText(/Last change/)).toBeInTheDocument();
  });
  it("singular wording", async () => {
    mockApi.get("/v1/admin/ad-placements", list([P()]));
    renderPage(<Page />);
    expect(await screen.findByText(/1 of 1 placement live/)).toBeInTheDocument();
  });
  it("empty state and no-live message", async () => {
    mockApi.get("/v1/admin/ad-placements", list([]));
    renderPage(<Page />);
    expect(await screen.findByText("No placements")).toBeInTheDocument();
    expect(screen.getByText(/No placements are live/)).toBeInTheDocument();
  });
  it("error with retry", async () => {
    mockApi.get("/v1/admin/ad-placements", fail(500, "down"));
    renderPage(<Page />);
    expect(await screen.findByText("down")).toBeInTheDocument();
    mockApi.get("/v1/admin/ad-placements", list([P()]));
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Unlock rail")).toBeInTheDocument();
  });
});

describe("AdsPage toggle", () => {
  it("confirms and applies a stop, with the body sent", async () => {
    mockApi.get("/v1/admin/ad-placements", list([P()]));
    mockApi.put("/v1/admin/ad-placements/p1", (c) => P(c.body));
    renderPage(<Page />);
    await userEvent.click(await screen.findByRole("switch", { name: "Unlock rail active" }));
    const dlg = screen.getByRole("dialog", { name: "Stop placement" });
    expect(dlg).toHaveTextContent("Stop serving");
    await userEvent.click(within(dlg).getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Unlock rail active" })).toHaveAttribute("aria-checked", "false"));
    const [c] = mockApi.callsTo("PUT", "/v1/admin/ad-placements/p1");
    expect(c.body).toMatchObject({ is_active: false, name: "Unlock rail", unit_id: "ca-app-1", reward_coins: 5 });
    expect(c.body.id).toBeUndefined();
  });
  it("go-live message lists platforms and reward; cancel does nothing", async () => {
    mockApi.get("/v1/admin/ad-placements", list([P({ is_active: false })]));
    renderPage(<Page />);
    await userEvent.click(await screen.findByRole("switch", { name: "Unlock rail active" }));
    const dlg = screen.getByRole("dialog", { name: "Go live" });
    expect(dlg).toHaveTextContent("android, ios");
    expect(dlg).toHaveTextContent("paying 5 coins per rewarded view");
    await userEvent.click(within(dlg).getByRole("button", { name: "Cancel" }));
    expect(mockApi.callsTo("PUT")).toHaveLength(0);
  });
  it("go-live message for no platforms / no reward", async () => {
    mockApi.get("/v1/admin/ad-placements", list([P({ is_active: false, platforms: [], reward_coins: null, slot: "paywall" })]));
    renderPage(<Page />);
    await userEvent.click(await screen.findByRole("switch"));
    const dlg = screen.getByRole("dialog", { name: "Go live" });
    expect(dlg).toHaveTextContent("on no platforms");
    expect(dlg).not.toHaveTextContent("paying");
  });
  it("rolls back and toasts when the write is refused", async () => {
    mockApi.get("/v1/admin/ad-placements", list([P()]));
    mockApi.put("/v1/admin/ad-placements/p1", fail(409, "conflict!"));
    renderPage(<Page />);
    await userEvent.click(await screen.findByRole("switch"));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Stop" }));
    expect(await screen.findByText("conflict!")).toBeInTheDocument();
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });
});

describe("AdsPage delete", () => {
  it("deletes and updates summary", async () => {
    mockApi.get("/v1/admin/ad-placements", list([P(), P({ id: "p2", name: "Other", is_active: false })]));
    mockApi.delete("/v1/admin/ad-placements/p1", undefined);
    renderPage(<Page />);
    await userEvent.click(await screen.findByRole("button", { name: "Delete Unlock rail" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Deleted “Unlock rail”")).toBeInTheDocument();
    expect(screen.queryByText("Unlock rail", { selector: "span" })).not.toBeInTheDocument();
    expect(screen.getByText(/No placements are live/)).toBeInTheDocument();
  });
  it("toasts on failure and keeps the row", async () => {
    mockApi.get("/v1/admin/ad-placements", list([P()]));
    mockApi.delete("/v1/admin/ad-placements/p1", fail(500, "nope"));
    renderPage(<Page />);
    await userEvent.click(await screen.findByRole("button", { name: "Delete Unlock rail" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("nope")).toBeInTheDocument();
    expect(screen.getByText("Unlock rail", { selector: "span" })).toBeInTheDocument();
  });
  it("cancel closes", async () => {
    mockApi.get("/v1/admin/ad-placements", list([P()]));
    renderPage(<Page />);
    await userEvent.click(await screen.findByRole("button", { name: "Delete Unlock rail" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockApi.callsTo("DELETE")).toHaveLength(0);
  });
});

describe("AdsPage form", () => {
  it("creates from empty list (first item), validating first", async () => {
    mockApi.get("/v1/admin/ad-placements", list([]));
    mockApi.post("/v1/admin/ad-placements", (c) => P({ ...c.body, id: "new" }));
    renderPage(<Page />);
    await userEvent.click(await screen.findByRole("button", { name: /New placement/ }));
    const dlg = screen.getByRole("dialog", { name: "New placement" });
    await userEvent.click(within(dlg).getByRole("button", { name: "Create" }));
    expect(within(dlg).getByText("Name is required.")).toBeInTheDocument();
    expect(within(dlg).getByText("The provider's unit id is required.")).toBeInTheDocument();
    expect(within(dlg).getByText(/need a whole number of coins/)).toBeInTheDocument();
    expect(mockApi.callsTo("POST")).toHaveLength(0);

    await userEvent.type(within(dlg).getByLabelText(/Name/), "  Main  ");
    expect(within(dlg).queryByText("Name is required.")).not.toBeInTheDocument();
    await userEvent.type(within(dlg).getByLabelText(/Unit ID/), "unit-9");
    await userEvent.type(within(dlg).getByLabelText(/Reward/), "7");
    await userEvent.click(within(dlg).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockApi.callsTo("POST", "/v1/admin/ad-placements")[0].body).toEqual({
      name: "Main",
      slot: "unlock_rewarded",
      provider: "admob",
      unit_id: "unit-9",
      platforms: ["android"],
      reward_coins: 7,
      frequency_cap_sec: 300,
      is_active: false,
      sort_order: 0,
    });
    expect(await screen.findByText("Placement created")).toBeInTheDocument();
    expect(screen.getByText("unit-9")).toBeInTheDocument();
  });

  it("validates platforms and cap, non-rewarded slot has no reward and sends null", async () => {
    mockApi.get("/v1/admin/ad-placements", list([P({ id: "z", name: "Z" })]));
    mockApi.post("/v1/admin/ad-placements", (c) => P({ ...c.body, id: "n2" }));
    renderPage(<Page />);
    await userEvent.click(await screen.findByRole("button", { name: /New placement/ }));
    const dlg = screen.getByRole("dialog");
    await userEvent.selectOptions(within(dlg).getByLabelText("Slot"), "paywall");
    expect(within(dlg).queryByLabelText(/Reward/)).not.toBeInTheDocument();
    await userEvent.selectOptions(within(dlg).getByLabelText("Provider"), "house");
    await userEvent.type(within(dlg).getByLabelText(/Name/), "Pay");
    await userEvent.type(within(dlg).getByLabelText(/Unit ID/), "u");
    await userEvent.click(within(dlg).getByRole("checkbox", { name: "android" }));
    const cap = within(dlg).getByLabelText(/Frequency cap/);
    await userEvent.clear(cap);
    await userEvent.type(cap, "-3");
    await userEvent.click(within(dlg).getByRole("button", { name: "Create" }));
    expect(within(dlg).getByText("Pick at least one platform.")).toBeInTheDocument();
    expect(within(dlg).getByText(/Whole number of seconds/)).toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole("checkbox", { name: "web" }));
    expect(within(dlg).queryByText("Pick at least one platform.")).not.toBeInTheDocument();
    await userEvent.clear(cap);
    await userEvent.type(cap, "0");
    await userEvent.type(within(dlg).getByLabelText("Sort order"), "4");
    await userEvent.click(within(dlg).getByRole("switch", { name: /Active/ }));
    await userEvent.click(within(dlg).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(mockApi.callsTo("POST")).toHaveLength(1));
    expect(mockApi.callsTo("POST")[0].body).toMatchObject({
      slot: "paywall", provider: "house", platforms: ["web"], reward_coins: null, frequency_cap_sec: 0, is_active: true, sort_order: 4,
    });
  });

  it("rejects a zero reward and clears the error on edit; unchecking platform", async () => {
    mockApi.get("/v1/admin/ad-placements", list([]));
    renderPage(<Page />);
    await userEvent.click(await screen.findByRole("button", { name: /New placement/ }));
    const dlg = screen.getByRole("dialog");
    await userEvent.type(within(dlg).getByLabelText(/Reward/), "0");
    await userEvent.type(within(dlg).getByLabelText(/Frequency cap/), "5");
    await userEvent.click(within(dlg).getByRole("button", { name: "Create" }));
    expect(within(dlg).getByText(/at least 1/)).toBeInTheDocument();
    await userEvent.type(within(dlg).getByLabelText(/Reward/), "2");
    expect(within(dlg).queryByText(/at least 1/)).not.toBeInTheDocument();
    await userEvent.type(within(dlg).getByLabelText(/Unit ID/), "u");
    expect(within(dlg).queryByText("The provider's unit id is required.")).not.toBeInTheDocument();
  });

  it("edits an existing placement via PUT and shows server error", async () => {
    mockApi.get("/v1/admin/ad-placements", list([P()]));
    mockApi.put("/v1/admin/ad-placements/p1", fail(422, "bad unit"));
    renderPage(<Page />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const dlg = screen.getByRole("dialog", { name: "Edit Unlock rail" });
    expect(within(dlg).getByLabelText(/Name/)).toHaveValue("Unlock rail");
    expect(within(dlg).getByRole("checkbox", { name: "ios" })).toBeChecked();
    await userEvent.click(within(dlg).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("bad unit")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    mockApi.put("/v1/admin/ad-placements/p1", (c) => P(c.body));
    await userEvent.clear(within(dlg).getByLabelText(/Name/));
    await userEvent.type(within(dlg).getByLabelText(/Name/), "Renamed");
    await userEvent.click(within(dlg).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Placement saved")).toBeInTheDocument();
    expect(await screen.findByText("Renamed")).toBeInTheDocument();
  });

  it("edit placement with null reward and missing cap defaults; cancel closes", async () => {
    mockApi.get("/v1/admin/ad-placements", list([P({ reward_coins: null, frequency_cap_sec: 0 })]));
    renderPage(<Page />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const dlg = screen.getByRole("dialog");
    expect(within(dlg).getByLabelText(/Reward/)).toHaveValue(null);
    expect(within(dlg).getByLabelText(/Frequency cap/)).toHaveValue(0);
    await userEvent.click(within(dlg).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("ignores sort_order garbage as 0", async () => {
    mockApi.get("/v1/admin/ad-placements", list([]));
    renderPage(<Page />);
    await userEvent.click(await screen.findByRole("button", { name: /New placement/ }));
    const so = screen.getByLabelText("Sort order");
    await userEvent.type(so, "5");
    await userEvent.clear(so);
    expect(so).toHaveValue(0);
  });
});

describe("AdsPage non-Error failures", () => {
  it("falls back to generic toasts for toggle, delete and save", async () => {
    mockApi.get("/v1/admin/ad-placements", list([P({ updated_at: null })]));
    renderPage(<Page />);
    await screen.findByText("Unlock rail");
    expect(screen.getByText(/Last change/)).toHaveTextContent("Last change");
    const real = vi.mocked(call).getMockImplementation()!;
    const failNext = () => vi.mocked(call).mockImplementationOnce((() => Promise.reject("boom")) as typeof call);

    failNext();
    await userEvent.click(screen.getByRole("switch"));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Stop" }));
    expect(await screen.findByText("Update failed")).toBeInTheDocument();

    failNext();
    await userEvent.click(screen.getByRole("button", { name: "Delete Unlock rail" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Delete failed")).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));

    failNext();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Save failed")).toBeInTheDocument();
    vi.mocked(call).mockImplementation(real);
  });
});
