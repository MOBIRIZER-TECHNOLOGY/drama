import "@/test/dom-matchers-pages";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderPage } from "@/test/render";
import { installDialog, installResizeObserver } from "@/test/dialog-pages";
import { fail, mockApi } from "@/test/api";
import Page from "./page";

// `call` always rejects with an Error; the page still guards against other throwables, so exercise that guard.
vi.mock("@/lib/api", async (orig) => {
  const real = await orig<typeof import("@/lib/api")>();
  return { ...real, call: vi.fn(real.call) };
});
import { call } from "@/lib/api";

beforeAll(() => {
  installDialog();
  installResizeObserver();
});

const E = (over: Record<string, unknown> = {}) => ({
  key: "paywall_copy",
  description: "Copy test",
  status: "draft",
  variants: { control: { a: 1 }, treatment: {} },
  allocation: { control: 50, treatment: 50 },
  started_at: null,
  ended_at: null,
  ...over,
});
const R = (over: Record<string, unknown> = {}) => ({
  variant: "control",
  is_control: true,
  users: 1000,
  unlocks: 400,
  unlock_rate: 0.4,
  purchasers: 50,
  conversion: 0.05,
  purchases: 60,
  revenue: { USD: 120.5 },
  coins_spent: 3000,
  p_value: null,
  lift_pct: null,
  significant: false,
  note: null,
  ...over,
});

async function openNew() {
  await userEvent.click(await screen.findByRole("button", { name: /New experiment/ }));
  return screen.getByRole("dialog", { name: "New experiment" });
}

describe("ExperimentsPage list", () => {
  it("renders rows with status, variants and action buttons", async () => {
    mockApi.get("/v1/admin/experiments", [
      E(),
      E({ key: "run_one", status: "running", description: null, started_at: "2026-01-01T00:00:00Z", allocation: { control: 100 }, variants: { control: {}, odd: {} } }),
      E({ key: "ended_one", status: "ended", started_at: "2026-01-01T00:00:00Z", ended_at: "2026-02-01T00:00:00Z" }),
    ]);
    renderPage(<Page />);
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(await screen.findByText("paywall_copy")).toBeInTheDocument();
    expect(screen.getAllByText("Copy test")).toHaveLength(2);
    expect(screen.getByText("control 100%")).toBeInTheDocument();
    expect(screen.getByText(/^odd\s*$/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Start/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Restart/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Stop/ })).toBeInTheDocument();
  });
  it("empty state button opens the create dialog", async () => {
    mockApi.get("/v1/admin/experiments", []);
    renderPage(<Page />);
    expect(await screen.findByText("No experiments")).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: /New experiment/ })[1]);
    expect(screen.getByRole("dialog", { name: "New experiment" })).toBeInTheDocument();
  });
  it("error state retries", async () => {
    mockApi.get("/v1/admin/experiments", () => fail(500, "kaput"));
    renderPage(<Page />);
    expect(await screen.findByText("kaput")).toBeInTheDocument();
    mockApi.get("/v1/admin/experiments", [E()]);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("paywall_copy")).toBeInTheDocument();
  });
});

describe("ExperimentsPage start/stop", () => {
  it("starts a draft", async () => {
    mockApi.get("/v1/admin/experiments", [E()]);
    mockApi.post("/v1/admin/experiments/paywall_copy/start", E({ status: "running", started_at: "2026-03-01T00:00:00Z" }));
    renderPage(<Page />);
    await userEvent.click(await screen.findByRole("button", { name: /Start/ }));
    const dlg = screen.getByRole("dialog", { name: "Start experiment" });
    expect(dlg).toHaveTextContent("New viewers will be assigned");
    expect(dlg).not.toHaveTextContent("previous end date");
    await userEvent.click(within(dlg).getByRole("button", { name: "Start" }));
    expect(await screen.findByText("paywall_copy is running")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Stop/ })).toBeInTheDocument();
    expect(mockApi.callsTo("POST", "/v1/admin/experiments/paywall_copy/start")).toHaveLength(1);
  });
  it("restart warns about end date; failure toasts and keeps dialog", async () => {
    mockApi.get("/v1/admin/experiments", [E({ status: "ended", started_at: "2026-01-01T00:00:00Z", ended_at: "2026-02-01T00:00:00Z" })]);
    mockApi.post("/v1/admin/experiments/paywall_copy/start", () => fail(409, "already"));
    renderPage(<Page />);
    await userEvent.click(await screen.findByRole("button", { name: /Restart/ }));
    const dlg = screen.getByRole("dialog");
    expect(dlg).toHaveTextContent("previous end date is cleared");
    await userEvent.click(within(dlg).getByRole("button", { name: "Start" }));
    expect(await screen.findByText("already")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Start experiment" })).toBeInTheDocument();
  });
  it("stops a running one", async () => {
    mockApi.get("/v1/admin/experiments", [E({ status: "running", started_at: "2026-01-01T00:00:00Z" })]);
    mockApi.post("/v1/admin/experiments/paywall_copy/stop", E({ status: "ended", started_at: "2026-01-01T00:00:00Z", ended_at: "2026-02-01T00:00:00Z" }));
    renderPage(<Page />);
    await userEvent.click(await screen.findByRole("button", { name: /Stop/ }));
    const dlg = screen.getByRole("dialog", { name: "Stop experiment" });
    expect(dlg).toHaveTextContent("results are frozen");
    await userEvent.click(within(dlg).getByRole("button", { name: "Stop" }));
    expect(await screen.findByText("paywall_copy stopped")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Restart/ })).toBeInTheDocument();
  });
  it("cancel leaves everything alone", async () => {
    mockApi.get("/v1/admin/experiments", [E()]);
    renderPage(<Page />);
    await userEvent.click(await screen.findByRole("button", { name: /Start/ }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mockApi.callsTo("POST")).toHaveLength(0);
  });
  it("non-Error failure uses generic message", async () => {
    mockApi.get("/v1/admin/experiments", [E()]);
    renderPage(<Page />);
    await userEvent.click(await screen.findByRole("button", { name: /Start/ }));
    vi.mocked(call).mockImplementationOnce((() => Promise.reject("x")) as typeof call);
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Start" }));
    expect(await screen.findByText("Action failed")).toBeInTheDocument();
  });
});

describe("ExperimentDialog create", () => {
  it("creates with defaults and sorts the new key into the list", async () => {
    mockApi.get("/v1/admin/experiments", [E({ key: "zzz_exp" })]);
    mockApi.post("/v1/admin/experiments", (c) => E({ ...c.body, status: "draft" }));
    renderPage(<Page />);
    const dlg = await openNew();
    await userEvent.type(within(dlg).getByLabelText(/^Key/), "Alpha_Test");
    expect(within(dlg).getByLabelText(/^Key/)).toHaveValue("alpha_test");
    await userEvent.type(within(dlg).getByLabelText("Description"), "  hello ");
    expect(within(dlg).getByText("Total 100%")).toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole("button", { name: "Create" }));
    expect(await screen.findByText("Experiment created")).toBeInTheDocument();
    expect(mockApi.callsTo("POST", "/v1/admin/experiments")[0].body).toEqual({
      key: "alpha_test",
      description: "hello",
      variants: { control: {}, treatment: {} },
      allocation: { control: 50, treatment: 50 },
    });
    const keys = (await screen.findAllByText(/^(alpha_test|zzz_exp)$/)).map((n) => n.textContent);
    expect(keys).toEqual(["alpha_test", "zzz_exp"]);
  });

  it("validates key, then per-row errors, then the total", async () => {
    mockApi.get("/v1/admin/experiments", []);
    mockApi.post("/v1/admin/experiments", (c) => E(c.body));
    renderPage(<Page />);
    const dlg = await openNew();
    const submit = () => userEvent.click(within(dlg).getByRole("button", { name: "Create" }));
    await submit();
    expect(within(dlg).getByText(/3–64 characters/)).toBeInTheDocument();
    await userEvent.type(within(dlg).getByLabelText(/^Key/), "ab");
    expect(within(dlg).queryByText(/3–64 characters/)).toBeNull();
    await userEvent.type(within(dlg).getByLabelText(/^Key/), "c");

    const names = within(dlg).getAllByLabelText("Name");
    const allocs = within(dlg).getAllByLabelText("Allocation %");
    const configs = within(dlg).getAllByRole("textbox", { name: /Config/ });

    // empty name
    await userEvent.clear(names[0]);
    await submit();
    expect(within(dlg).getByText("Variant name is required.")).toBeInTheDocument();
    expect(within(dlg).getByText("Fix the highlighted variants.")).toBeInTheDocument();
    // bad name chars
    await userEvent.type(names[0], "bad name!");
    await submit();
    expect(within(dlg).getByText(/Use letters, digits/)).toBeInTheDocument();
    // duplicate
    await userEvent.clear(names[0]);
    await userEvent.type(names[0], "same");
    await userEvent.clear(names[1]);
    await userEvent.type(names[1], "same");
    await submit();
    expect(within(dlg).getByText("Duplicate variant “same”.")).toBeInTheDocument();
    await userEvent.clear(names[1]);
    await userEvent.type(names[1], "other");
    // bad JSON
    fireEvent.change(configs[0], { target: { value: "{nope" } });
    await submit();
    expect(within(dlg).getAllByText(/Invalid JSON/).length).toBeGreaterThan(0);
    fireEvent.change(configs[0], { target: { value: "[1]" } });
    await submit();
    expect(within(dlg).getAllByText(/Must be a JSON object/).length).toBeGreaterThan(0);
    fireEvent.change(configs[0], { target: { value: '{"a":1}' } });
    // bad allocation
    await userEvent.clear(allocs[0]);
    await submit();
    expect(within(dlg).getByText(/Allocation must be a whole number/)).toBeInTheDocument();
    await userEvent.type(allocs[0], "150");
    await submit();
    expect(within(dlg).getByText(/Allocation must be a whole number/)).toBeInTheDocument();
    await userEvent.clear(allocs[0]);
    await userEvent.type(allocs[0], "30");
    await submit();
    expect(within(dlg).getByText("Allocation must sum to 100 (currently 80).")).toBeInTheDocument();
    expect(mockApi.callsTo("POST")).toHaveLength(0);

    // split evenly fixes it
    await userEvent.click(within(dlg).getByRole("button", { name: "Add variant" }));
    expect(within(dlg).getByText(/Variants/)).toHaveTextContent("(3)");
    await userEvent.click(within(dlg).getByRole("button", { name: "Split evenly" }));
    expect(within(dlg).getAllByLabelText("Allocation %").map((i) => (i as HTMLInputElement).value)).toEqual(["34", "33", "33"]);
    // the third variant has no name yet
    await userEvent.type(within(dlg).getAllByLabelText("Name")[2], "third");
    await submit();
    await waitFor(() => expect(mockApi.callsTo("POST")).toHaveLength(1));
    expect(mockApi.callsTo("POST")[0].body.variants).toEqual({ same: { a: 1 }, other: {}, third: {} });
  });

  it("requires two variants after removing one is blocked; remove works above two", async () => {
    mockApi.get("/v1/admin/experiments", []);
    renderPage(<Page />);
    const dlg = await openNew();
    expect(within(dlg).getAllByRole("button", { name: /Remove variant/ })[0]).toBeDisabled();
    await userEvent.click(within(dlg).getByRole("button", { name: "Add variant" }));
    await userEvent.click(within(dlg).getByRole("button", { name: /^Remove variant$/ }));
    expect(within(dlg).getAllByLabelText("Name")).toHaveLength(2);
  });

  it("shows a minimum-two-variants message when rows are fewer (via edit of a one-variant experiment)", async () => {
    mockApi.get("/v1/admin/experiments", [E({ variants: { solo: {} }, allocation: { solo: 100 } })]);
    renderPage(<Page />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const dlg = screen.getByRole("dialog");
    await userEvent.click(within(dlg).getByRole("button", { name: "Save" }));
    expect(within(dlg).getByText("At least two variants are required.")).toBeInTheDocument();
  });

  it("key-related server error lands on the key field; other errors toast", async () => {
    mockApi.get("/v1/admin/experiments", []);
    mockApi.post("/v1/admin/experiments", () => fail(409, "Key already exists"));
    renderPage(<Page />);
    const dlg = await openNew();
    await userEvent.type(within(dlg).getByLabelText(/^Key/), "dup_key");
    await userEvent.click(within(dlg).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(within(dlg).getByText("Key already exists")).toBeInTheDocument());
    mockApi.post("/v1/admin/experiments", () => fail(500, "database down"));
    await userEvent.click(within(dlg).getByRole("button", { name: "Create" }));
    expect(await screen.findByText("database down")).toBeInTheDocument();
    vi.mocked(call).mockImplementationOnce((() => Promise.reject(0)) as typeof call);
    await userEvent.click(within(dlg).getByRole("button", { name: "Create" }));
    expect(await screen.findByText("Save failed")).toBeInTheDocument();
  });
});

describe("ExperimentDialog edit", () => {
  it("locks names/variant set once started and PUTs", async () => {
    const started = E({ status: "running", started_at: "2026-01-01T00:00:00Z", allocation: { control: 70 }, variants: { control: { a: 1 }, treatment: null } });
    mockApi.get("/v1/admin/experiments", [started]);
    mockApi.put("/v1/admin/experiments/paywall_copy", (c) => ({ ...started, ...c.body }));
    renderPage(<Page />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const dlg = screen.getByRole("dialog", { name: "Edit paywall_copy" });
    expect(dlg).toHaveTextContent("This experiment has started");
    expect(within(dlg).getByLabelText(/^Key/)).toBeDisabled();
    expect(within(dlg).getAllByLabelText("Name")[0]).toBeDisabled();
    expect(within(dlg).getByRole("button", { name: "Add variant" })).toBeDisabled();
    const allocs = within(dlg).getAllByLabelText("Allocation %") as HTMLInputElement[];
    expect(allocs.map((a) => a.value)).toEqual(["70", ""]);
    await userEvent.type(allocs[1], "30");
    await userEvent.click(within(dlg).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Experiment saved")).toBeInTheDocument();
    expect(mockApi.callsTo("PUT", "/v1/admin/experiments/paywall_copy")[0].body).toEqual({
      key: "paywall_copy",
      description: "Copy test",
      variants: { control: { a: 1 }, treatment: {} },
      allocation: { control: 70, treatment: 30 },
    });
  });
  it("key-ish errors on edit are toasts, not field errors; Format button reformats config", async () => {
    mockApi.get("/v1/admin/experiments", [E()]);
    mockApi.put("/v1/admin/experiments/paywall_copy", () => fail(400, "bad key thing"));
    renderPage(<Page />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const dlg = screen.getByRole("dialog");
    const cfg = within(dlg).getAllByRole("textbox", { name: /Config/ })[0] as HTMLTextAreaElement;
    expect(cfg.value).toBe('{\n  "a": 1\n}');
    fireEvent.change(cfg, { target: { value: '{"a":1,"b":2}' } });
    await userEvent.click(within(dlg).getAllByRole("button", { name: "Format" })[0]);
    expect(cfg.value).toBe('{\n  "a": 1,\n  "b": 2\n}');
    await userEvent.click(within(dlg).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("bad key thing")).toBeInTheDocument();
  });
  it("cancel closes", async () => {
    mockApi.get("/v1/admin/experiments", [E()]);
    renderPage(<Page />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("ResultsDialog", () => {
  const open = async (exp = E()) => {
    mockApi.get("/v1/admin/experiments", [exp]);
    renderPage(<Page />);
    await userEvent.click(await screen.findByRole("button", { name: /Results/ }));
    return screen.getByRole("dialog", { name: "Results · paywall_copy" });
  };
  it("shows verdicts for every variant situation", async () => {
    mockApi.get("/v1/admin/experiments/paywall_copy/results", [
      R(),
      R({ variant: "win", is_control: false, p_value: 0.0004, lift_pct: 12.34, significant: true, revenue: { USD: 200, EUR: 5 } }),
      R({ variant: "lose", is_control: false, p_value: 0.02, lift_pct: -8, significant: true }),
      R({ variant: "meh", is_control: false, p_value: 0.4321, lift_pct: 1, significant: false }),
      R({ variant: "nolift", is_control: false, p_value: 0.5, lift_pct: null, significant: false }),
      R({ variant: "noted", is_control: false, note: "Not enough users" }),
      R({ variant: "nop", is_control: false }),
    ]);
    const dlg = await open();
    expect(dlg).toHaveTextContent("not started: counts include all assignments");
    expect(await within(dlg).findByText("baseline")).toBeInTheDocument();
    expect(dlg).toHaveTextContent("winning");
    expect(dlg).toHaveTextContent("+12.3%");
    expect(dlg).toHaveTextContent("p = <0.001");
    expect(dlg).toHaveTextContent("losing");
    expect(dlg).toHaveTextContent("-8.0%");
    expect(dlg).toHaveTextContent("no call yet");
    expect(dlg).toHaveTextContent("p = 0.432 (needs < 0.05)");
    expect(dlg).toHaveTextContent("Not enough users");
    expect(dlg).toHaveTextContent("40.0%");
    expect(dlg).toHaveTextContent("5.00%");
    expect(dlg).toHaveTextContent("$120.50");
    expect(dlg).toHaveTextContent("€5.00");
    expect(dlg).toHaveTextContent("control");
    await userEvent.click(within(dlg).getAllByRole("button", { name: "Close" }).at(-1)!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("no revenue shows a dash and started/ended copy", async () => {
    mockApi.get("/v1/admin/experiments/paywall_copy/results", [R({ revenue: {} })]);
    const dlg = await open(E({ status: "ended", started_at: "2026-01-01T00:00:00Z", ended_at: "2026-02-01T00:00:00Z" }));
    await within(dlg).findByText("baseline");
    expect(dlg).toHaveTextContent("since");
    expect(dlg).toHaveTextContent("· ended");
  });
  it("empty results", async () => {
    mockApi.get("/v1/admin/experiments/paywall_copy/results", []);
    const dlg = await open();
    expect(await within(dlg).findByText("No variants")).toBeInTheDocument();
  });
  it("error then retry", async () => {
    mockApi.get("/v1/admin/experiments/paywall_copy/results", () => fail(500, "no stats"));
    const dlg = await open();
    expect(await within(dlg).findByText("no stats")).toBeInTheDocument();
    mockApi.get("/v1/admin/experiments/paywall_copy/results", []);
    await userEvent.click(within(dlg).getByRole("button", { name: "Try again" }));
    expect(await within(dlg).findByText("No variants")).toBeInTheDocument();
  });
});
