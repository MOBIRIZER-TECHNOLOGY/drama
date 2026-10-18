import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appWrapper } from "@/test-utils/app";
import { setAuth } from "@/test-utils/auth-context";
import { MyListView } from "./MyListView";

vi.mock("next/navigation", () => import("@/test-utils/next-navigation"));
vi.mock("@/lib/auth-context", () => import("@/test-utils/auth-context"));
const GET = vi.fn();
const DELETE = vi.fn();
vi.mock("@/lib/client-api", () => ({ clientApi: { GET: (...a: unknown[]) => GET(...a), DELETE: (...a: unknown[]) => DELETE(...a) } }));
const toast = vi.fn();
vi.mock("@/lib/toast", () => ({ useToast: () => toast }));

HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
  this.removeAttribute("open");
  this.dispatchEvent(new Event("close"));
};

const ok = (data: unknown) => ({ data, response: { ok: true, status: 200 } });
const fail = (message = "bad") => ({ error: { detail: { code: "e", message } }, response: { ok: false, status: 500 } });

const series = (id: string, over: object = {}) => ({ id, slug: `s-${id}`, title: `Title ${id}`, cover_url: "/c.jpg", episode_count: 10, categories: [], ...over });
const hist = (id: string, over: object = {}) => ({
  episode_id: `e-${id}`,
  series: series(id),
  episode_number: 3,
  position_sec: 30,
  duration_sec: 120,
  completed: false,
  updated_at: new Date().toISOString(),
  ...over,
});

let list: { history: unknown[]; favorites: unknown[] };
const mount = (lang = "en") => render(<MyListView />, { wrapper: appWrapper({ lang }) });

beforeEach(() => {
  GET.mockReset();
  DELETE.mockReset();
  setAuth({ status: "authenticated" });
  list = { history: [hist("a"), hist("b", { completed: true, episode_number: 10, duration_sec: 0 })], favorites: [series("f1")] };
  GET.mockImplementation(async () => ok(list));
});

describe("MyListView", () => {
  it("gates on sign-in", () => {
    setAuth({ status: "anonymous" });
    mount();
    expect(screen.getByText("Sign in to continue")).toBeInTheDocument();
  });

  it("loads with the language and shows skeletons first", async () => {
    const { container } = mount("hi");
    expect(container.querySelectorAll(".k-skeleton").length).toBe(9);
    await screen.findByText("Title a");
    expect(GET).toHaveBeenCalledWith("/v1/me/list", { params: { query: { lang: "hi" } } });
  });

  it("renders history with progress, resume/next links and favourites", async () => {
    mount();
    await screen.findByText("Title a");
    const a = screen.getByText("Title a").closest("li")!;
    expect(a).toHaveTextContent("Episode 3 · 0:30 / 2:00");
    expect((a.querySelector("div[style]") as HTMLElement).style.width).toBe("25%");
    expect(within(a).getByText("Resume").closest("a")!.getAttribute("href")).toBe("/series/s-a?ep=3");
    const b = screen.getByText("Title b").closest("li")!;
    expect(b).toHaveTextContent("Completed");
    expect((b.querySelector("div[style]") as HTMLElement).style.width).toBe("100%");
    // completed final episode stays on the last episode
    expect(within(b).getByText("Next").closest("a")!.getAttribute("href")).toBe("/series/s-b?ep=10");
    expect(screen.getByText("Title f1")).toBeInTheDocument();
  });

  it("advances to the next episode when a non-final episode is completed, with language prefix", async () => {
    list.history = [hist("c", { completed: true, episode_number: 2, duration_sec: 0 })];
    list.favorites = [];
    mount("hi");
    await screen.findByText("Title c");
    expect(screen.getByText("Next").closest("a")!.getAttribute("href")).toBe("/hi/series/s-c?ep=3");
    expect(screen.getByText("No favourites yet")).toBeInTheDocument();
  });

  it("0% progress for incomplete episodes with unknown duration, and no timestamps", async () => {
    list.history = [hist("d", { duration_sec: null, position_sec: 0 })];
    mount();
    const li = (await screen.findByText("Title d")).closest("li")!;
    expect((li.querySelector("div[style]") as HTMLElement).style.width).toBe("0%");
    expect(li.textContent).not.toContain("/");
  });

  it("caps the progress bar at 100% and handles series without cover or episode_count", async () => {
    list.history = [hist("e", { position_sec: 500, duration_sec: 100, series: series("e", { cover_url: null, episode_count: 0 }) })];
    mount();
    const li = (await screen.findByText("Title e")).closest("li")!;
    expect((li.querySelector("div[style]") as HTMLElement).style.width).toBe("100%");
    expect(li.querySelector("img")).toBeNull();
  });

  it("shows an empty state for no history", async () => {
    list.history = [];
    mount();
    expect(await screen.findByText("Nothing in progress")).toBeInTheDocument();
    expect(screen.getByText("Browse dramas").closest("a")!.getAttribute("href")).toBe("/");
    // only the confirm dialog's button remains; the header action is hidden
    expect(screen.getAllByText("Clear history")).toHaveLength(1);
  });

  it("filters to unfinished only (checkbox appears only when something is finished)", async () => {
    mount();
    const box = (await screen.findByLabelText("Unfinished only")) as HTMLInputElement;
    fireEvent.click(box);
    expect(screen.queryByText("Title b")).toBeNull();
    expect(screen.getByText("Title a")).toBeInTheDocument();
    // everything unfinished is hidden -> "All caught up"
    list.history = [];
  });

  it("shows 'All caught up' when the filter leaves nothing", async () => {
    list.history = [hist("b", { completed: true, episode_number: 10 })];
    mount();
    fireEvent.click(await screen.findByLabelText("Unfinished only"));
    expect(screen.getByText("All caught up")).toBeInTheDocument();
  });

  it("hides the checkbox when every entry is unfinished", async () => {
    list.history = [hist("a")];
    mount();
    await screen.findByText("Title a");
    expect(screen.queryByLabelText("Unfinished only")).toBeNull();
  });

  it("removes a single title", async () => {
    DELETE.mockResolvedValue(ok(null));
    mount();
    const li = (await screen.findByText("Title a")).closest("li")!;
    await act(async () => void fireEvent.click(within(li).getByLabelText("Remove from history")));
    expect(DELETE).toHaveBeenCalledWith("/v1/me/history", { params: { query: { series_id: "a" } } });
    expect(screen.queryByText("Title a")).toBeNull();
    expect(screen.getByText("Title b")).toBeInTheDocument();
  });

  it("toasts and keeps the row when removal fails", async () => {
    DELETE.mockResolvedValue(fail("cannot"));
    mount();
    const li = (await screen.findByText("Title a")).closest("li")!;
    await act(async () => void fireEvent.click(within(li).getByLabelText("Remove from history")));
    expect(toast).toHaveBeenCalledWith("cannot", "error");
    expect(screen.getByText("Title a")).toBeInTheDocument();
  });

  it("clearing everything asks for confirmation first, and cancel does nothing", async () => {
    mount();
    await screen.findByText("Title a");
    fireEvent.click(screen.getAllByText("Clear history", { selector: "button" }).at(-1)!);
    const dlg = screen.getByText("Clear your watch history?").closest("dialog")!;
    expect(dlg).toHaveTextContent("This removes all 2 titles");
    fireEvent.click(within(dlg).getByText("Cancel"));
    expect(DELETE).not.toHaveBeenCalled();
    expect(dlg.hasAttribute("open")).toBe(false);
  });

  it("clicking the dialog backdrop dismisses it", async () => {
    mount();
    await screen.findByText("Title a");
    fireEvent.click(screen.getAllByText("Clear history", { selector: "button" }).at(-1)!);
    const dlg = screen.getByText("Clear your watch history?").closest("dialog")!;
    expect(dlg.hasAttribute("open")).toBe(true);
    fireEvent.click(dlg);
    expect(dlg.hasAttribute("open")).toBe(false);
    expect(DELETE).not.toHaveBeenCalled();
  });

  it("confirming clears all history", async () => {
    DELETE.mockResolvedValue(ok(null));
    mount();
    await screen.findByText("Title a");
    fireEvent.click(screen.getAllByText("Clear history", { selector: "button" }).at(-1)!);
    const dlg = screen.getByText("Clear your watch history?").closest("dialog")!;
    await act(async () => void fireEvent.click(within(dlg).getByText("Clear history")));
    expect(DELETE).toHaveBeenCalledWith("/v1/me/history", { params: { query: {} } });
    expect(await screen.findByText("Nothing in progress")).toBeInTheDocument();
    expect(dlg.hasAttribute("open")).toBe(false);
  });

  it("shows an error state and retries", async () => {
    GET.mockResolvedValueOnce(fail());
    mount();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await act(async () => void fireEvent.click(screen.getByText("Try again")));
    expect(await screen.findByText("Title a")).toBeInTheDocument();
  });
});
