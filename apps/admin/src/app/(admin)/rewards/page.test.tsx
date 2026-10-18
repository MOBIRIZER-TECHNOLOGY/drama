import "@/test/dom-matchers-pages";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
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
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const T = (over: Record<string, unknown> = {}) => ({
  id: "t1",
  platform: "android",
  kind: "link",
  title: "Visit site",
  description: null,
  coins: 10,
  url: "https://example.com/p",
  timer_seconds: 15,
  frequency: "once",
  is_active: true,
  sort_order: 0,
  ...over,
});
const setup = (tasks: unknown[]) => {
  mockApi.get("/v1/admin/reward-tasks", tasks);
  return renderPage(<Page />);
};
const card = (name: string) => screen.getByRole("heading", { name }).closest("section") as HTMLElement;

describe("RewardsPage list", () => {
  it("groups tasks by platform, sorted, with empty platforms", async () => {
    setup([
      T({ id: "b", title: "Second", sort_order: 2, timer_seconds: 0, url: null, kind: "share", frequency: "daily" }),
      T({ id: "a", title: "First", sort_order: 1 }),
      T({ id: "w", title: "Web one", platform: "web", kind: "rewarded_ad" }),
    ]);
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    await screen.findByText("First");
    const rows = within(card("Android")).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("First");
    expect(rows[1]).toHaveTextContent("Second");
    expect(within(card("Android")).getByText("15s")).toBeInTheDocument();
    expect(within(card("Android")).getByText("—")).toBeInTheDocument();
    expect(within(card("Android")).getByText("daily")).toBeInTheDocument();
    expect(within(card("Android")).getByRole("link", { name: "https://example.com/p" })).toHaveAttribute("target", "_blank");
    expect(within(card("Web")).getByText("rewarded ad")).toBeInTheDocument();
    expect(screen.getByText("No tasks for iOS")).toBeInTheDocument();
  });
  it("shows the AdMob callback URL only with rewarded ads, and copies it", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example.com");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    setup([T({ kind: "rewarded_ad" })]);
    expect(await screen.findByText("https://api.example.com/v1/ads/admob/ssv")).toBeInTheDocument();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith("https://api.example.com/v1/ads/admob/ssv");
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });
  it("hint falls back to a relative URL without a base and is hidden otherwise", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", undefined as unknown as string);
    delete process.env.NEXT_PUBLIC_API_URL;
    setup([T({ kind: "rewarded_ad" })]);
    expect(await screen.findByText("/v1/ads/admob/ssv")).toBeInTheDocument();
  });
  it("no hint without rewarded ads", async () => {
    setup([T()]);
    await screen.findByText("Visit site");
    expect(screen.queryByText(/verification callback/)).toBeNull();
  });
  it("error state with retry", async () => {
    mockApi.get("/v1/admin/reward-tasks", () => fail(500, "rewards down"));
    renderPage(<Page />);
    expect(await screen.findByText("rewards down")).toBeInTheDocument();
    mockApi.get("/v1/admin/reward-tasks", [T()]);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Visit site")).toBeInTheDocument();
  });
});

describe("RewardsPage toggle and delete", () => {
  it("deactivates using the full body", async () => {
    setup([T({ description: "d" }), T({ id: "t9", title: "Bystander", sort_order: 5 })]);
    mockApi.put("/v1/admin/reward-tasks/t1", (c) => T(c.body));
    await userEvent.click(await screen.findByRole("switch", { name: "Visit site active" }));
    const dlg = screen.getByRole("dialog", { name: "Deactivate task" });
    expect(dlg).toHaveTextContent("Stop offering “Visit site” on Android?");
    await userEvent.click(within(dlg).getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Visit site active" })).toHaveAttribute("aria-checked", "false"));
    expect(screen.getByRole("switch", { name: "Bystander active" })).toHaveAttribute("aria-checked", "true");
    expect(mockApi.callsTo("PUT", "/v1/admin/reward-tasks/t1")[0].body).toEqual({
      platform: "android", kind: "link", title: "Visit site", description: "d", coins: 10, url: "https://example.com/p",
      timer_seconds: 15, frequency: "once", is_active: false, sort_order: 0,
    });
  });
  it("activation message names coins and frequency, cancel is inert, failure rolls back", async () => {
    setup([T({ is_active: false, platform: "ios", frequency: "daily", coins: 7 }), T({ id: "t9", title: "Bystander", platform: "ios", sort_order: 5 })]);
    await userEvent.click(await screen.findByRole("switch", { name: "Visit site active" }));
    let dlg = screen.getByRole("dialog", { name: "Activate task" });
    expect(dlg).toHaveTextContent("Offer “Visit site” on iOS? It pays 7 coins per daily completion");
    await userEvent.click(within(dlg).getByRole("button", { name: "Cancel" }));
    expect(mockApi.callsTo("PUT")).toHaveLength(0);
    mockApi.put("/v1/admin/reward-tasks/t1", () => fail(500, "nope"));
    await userEvent.click(screen.getByRole("switch", { name: "Visit site active" }));
    dlg = screen.getByRole("dialog", { name: "Activate task" });
    await userEvent.click(within(dlg).getByRole("button", { name: "Activate" }));
    expect(await screen.findByText("nope")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Visit site active" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("switch", { name: "Bystander active" })).toHaveAttribute("aria-checked", "true");
  });
  it("web label in the dialog and generic non-Error failures", async () => {
    setup([T({ platform: "web" })]);
    await userEvent.click(await screen.findByRole("switch"));
    expect(screen.getByRole("dialog")).toHaveTextContent("on Web?");
    vi.mocked(call).mockImplementationOnce((() => Promise.reject(1)) as typeof call);
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Deactivate" }));
    expect(await screen.findByText("Update failed")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete Visit site" }));
    vi.mocked(call).mockImplementationOnce((() => Promise.reject(1)) as typeof call);
    await userEvent.click(within(screen.getByRole("dialog", { name: "Delete task" })).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Delete failed")).toBeInTheDocument();
  });
  it("deletes a task", async () => {
    setup([T(), T({ id: "t2", title: "Keep me" })]);
    mockApi.delete("/v1/admin/reward-tasks/t1", undefined);
    await userEvent.click(await screen.findByRole("button", { name: "Delete Visit site" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "Delete task" })).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Deleted “Visit site”")).toBeInTheDocument();
    expect(screen.getByText("Keep me")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Visit site" })).toBeNull();
  });
  it("delete failure keeps the row; cancel closes", async () => {
    setup([T()]);
    mockApi.delete("/v1/admin/reward-tasks/t1", () => fail(409, "claimed"));
    await userEvent.click(await screen.findByRole("button", { name: "Delete Visit site" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("claimed")).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Delete Visit site" })).toBeInTheDocument();
  });
});

describe("TaskDialog", () => {
  it("New task button defaults to Android, per-card Add to that platform; validation; create", async () => {
    setup([T({ id: "old", title: "Old" })]);
    mockApi.post("/v1/admin/reward-tasks", (c) => T({ ...c.body, id: "new" }));
    await screen.findByText("Old");
    await userEvent.click(within(card("iOS")).getByRole("button", { name: /Add/ }));
    let dlg = screen.getByRole("dialog", { name: "New task" });
    expect(within(dlg).getByLabelText("Platform")).toHaveValue("ios");
    await userEvent.click(within(dlg).getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getByRole("button", { name: /New task/ }));
    dlg = screen.getByRole("dialog", { name: "New task" });
    expect(within(dlg).getByLabelText("Platform")).toHaveValue("android");

    const submit = () => userEvent.click(within(dlg).getByRole("button", { name: "Create" }));
    fireEvent.change(within(dlg).getByLabelText(/^Coins/), { target: { value: "0" } });
    fireEvent.change(within(dlg).getByLabelText("URL"), { target: { value: "not a url" } });
    await submit();
    expect(within(dlg).getByText("Title is required.")).toBeInTheDocument();
    expect(within(dlg).getByText("Coins must be a whole number of at least 1.")).toBeInTheDocument();
    expect(within(dlg).getByText("Enter a full URL, e.g. https://example.com/page.")).toBeInTheDocument();
    fireEvent.change(within(dlg).getByLabelText("URL"), { target: { value: "ftp://example.com" } });
    await submit();
    expect(within(dlg).getByText("Use an http(s) URL.")).toBeInTheDocument();
    fireEvent.change(within(dlg).getByLabelText(/^Coins/), { target: { value: "2.5" } });
    await submit();
    expect(within(dlg).getByText("Coins must be a whole number of at least 1.")).toBeInTheDocument();
    expect(mockApi.callsTo("POST")).toHaveLength(0);

    await userEvent.type(within(dlg).getByLabelText(/^Title/), "  Share it  ");
    expect(within(dlg).queryByText("Title is required.")).toBeNull();
    fireEvent.change(within(dlg).getByLabelText(/^Coins/), { target: { value: "25" } });
    expect(within(dlg).queryByText(/Coins must be/)).toBeNull();
    fireEvent.change(within(dlg).getByLabelText("URL"), { target: { value: "http://example.com/x" } });
    expect(within(dlg).queryByText("Use an http(s) URL.")).toBeNull();
    await userEvent.selectOptions(within(dlg).getByLabelText("Platform"), "web");
    await userEvent.selectOptions(within(dlg).getByLabelText("Kind"), "share");
    await userEvent.selectOptions(within(dlg).getByLabelText("Frequency"), "daily");
    fireEvent.change(within(dlg).getByLabelText("Timer (seconds)"), { target: { value: "-4" } });
    fireEvent.change(within(dlg).getByLabelText("Sort order"), { target: { value: "3" } });
    await userEvent.type(within(dlg).getByLabelText("Description"), " why ");
    await userEvent.click(within(dlg).getByRole("switch", { name: "Active" }));
    await submit();
    expect(await screen.findByText("Task created")).toBeInTheDocument();
    expect(mockApi.callsTo("POST", "/v1/admin/reward-tasks")[0].body).toEqual({
      platform: "web", kind: "share", title: "Share it", description: "why", coins: 25, url: "http://example.com/x",
      timer_seconds: 0, frequency: "daily", is_active: false, sort_order: 3,
    });
    expect(within(card("Web")).getByText("Share it")).toBeInTheDocument();
  });

  it("blank url/description become null; timer garbage and sort garbage fall back to 0", async () => {
    setup([]);
    mockApi.post("/v1/admin/reward-tasks", (c) => T(c.body));
    await screen.findByText("No tasks for iOS");
    await userEvent.click(screen.getByRole("button", { name: /New task/ }));
    const dlg = screen.getByRole("dialog");
    await userEvent.type(within(dlg).getByLabelText(/^Title/), "Bare");
    fireEvent.change(within(dlg).getByLabelText("Timer (seconds)"), { target: { value: "9" } });
    fireEvent.change(within(dlg).getByLabelText("Timer (seconds)"), { target: { value: "" } });
    fireEvent.change(within(dlg).getByLabelText("Sort order"), { target: { value: "9" } });
    fireEvent.change(within(dlg).getByLabelText("Sort order"), { target: { value: "" } });
    await userEvent.click(within(dlg).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(mockApi.callsTo("POST")).toHaveLength(1));
    expect(mockApi.callsTo("POST")[0].body).toMatchObject({ url: null, description: null, timer_seconds: 0, sort_order: 0, coins: 10, platform: "android", kind: "link" });
  });

  it("edits an existing task", async () => {
    setup([T({ description: "old desc" }), T({ id: "t9", title: "Bystander", sort_order: 5 })]);
    mockApi.put("/v1/admin/reward-tasks/t1", (c) => T({ ...c.body }));
    await userEvent.click((await screen.findAllByRole("button", { name: "Edit" }))[0]);
    const dlg = screen.getByRole("dialog", { name: "Edit task" });
    expect(within(dlg).getByLabelText(/^Title/)).toHaveValue("Visit site");
    expect(within(dlg).getByLabelText("Description")).toHaveValue("old desc");
    await userEvent.clear(within(dlg).getByLabelText(/^Title/));
    await userEvent.type(within(dlg).getByLabelText(/^Title/), "Renamed");
    await userEvent.click(within(dlg).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Task saved")).toBeInTheDocument();
    expect(await screen.findByText("Renamed")).toBeInTheDocument();
    expect(screen.getByText("Bystander")).toBeInTheDocument();
  });

  it("edit with null fields prefills safely", async () => {
    setup([T({ url: null, description: null, timer_seconds: 0 })]);
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const dlg = screen.getByRole("dialog");
    expect(within(dlg).getByLabelText("URL")).toHaveValue("");
    expect(within(dlg).getByLabelText("Timer (seconds)")).toHaveValue(0);
  });

  it("server and non-Error failures toast and keep the dialog open", async () => {
    setup([]);
    mockApi.post("/v1/admin/reward-tasks", () => fail(422, "bad payload"));
    await screen.findByText("No tasks for iOS");
    await userEvent.click(screen.getByRole("button", { name: /New task/ }));
    const dlg = screen.getByRole("dialog");
    await userEvent.type(within(dlg).getByLabelText(/^Title/), "X");
    await userEvent.click(within(dlg).getByRole("button", { name: "Create" }));
    expect(await screen.findByText("bad payload")).toBeInTheDocument();
    vi.mocked(call).mockImplementationOnce((() => Promise.reject(1)) as typeof call);
    await userEvent.click(within(dlg).getByRole("button", { name: "Create" }));
    expect(await screen.findByText("Save failed")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "New task" })).toBeInTheDocument();
  });
});
