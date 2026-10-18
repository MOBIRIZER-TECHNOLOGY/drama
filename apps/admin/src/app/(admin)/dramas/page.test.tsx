import "@/test/dramas-dom-matchers";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fail, mockApi } from "@/test/api";
import { renderPage } from "@/test/render";
import DramasPage from "./page";

const item = (n: number, over: Record<string, unknown> = {}) => ({
  id: `s${n}`,
  slug: `show-${n}`,
  cover_url: null,
  original_language: "hi",
  status: "published",
  is_featured: false,
  is_premium: false,
  episode_count: n,
  view_count: 1500 * n,
  like_count: n,
  updated_at: "2030-01-02T03:04:00Z",
  translations: [
    { lang: "en", title: `English ${n}` },
    { lang: "hi", title: `Hindi ${n}` },
  ],
  ...over,
});
const page = (items: unknown[], total = items.length) => ({ items, total });
const lastQuery = () => mockApi.callsTo("GET", "/v1/admin/series").at(-1)?.query;
const fakeTime = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
afterEach(() => vi.useRealTimers());

describe("DramasPage", () => {
  it("lists series with title, slug, badges, counts and edit links", async () => {
    mockApi.get(
      "/v1/admin/series",
      page([item(1, { is_featured: true, is_premium: true, cover_url: "https://cdn.test/c.jpg" }), item(2, { translations: [], slug: "no-title", status: "draft" })]),
    );
    renderPage(<DramasPage />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(await screen.findByText("Hindi 1")).toBeInTheDocument();
    expect(screen.getByText("2 series")).toBeInTheDocument();
    expect(screen.getByText("featured")).toBeInTheDocument();
    expect(screen.getByText("premium")).toBeInTheDocument();
    expect(screen.getByText("1.5K")).toBeInTheDocument();
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0].querySelector("img")?.getAttribute("src")).toBe("https://cdn.test/c.jpg");
    expect(rows[1].querySelector("img")).toBeNull();
    // a series without any translation falls back to its slug
    expect(within(rows[1]).getAllByText("no-title").length).toBeGreaterThan(0);
    expect(within(rows[0]).getByRole("link", { name: "Edit" })).toHaveAttribute("href", "/dramas/s1");
    expect(screen.getByRole("link", { name: /New series/ })).toHaveAttribute("href", "/dramas/new");
    expect(screen.getByRole("link", { name: /Video assets/ })).toHaveAttribute("href", "/dramas/assets");
    expect(lastQuery()).toEqual({ limit: "20", offset: "0" });
  });

  it("shows the empty state with a create action when there are no series", async () => {
    mockApi.get("/v1/admin/series", page([]));
    renderPage(<DramasPage />);
    expect(await screen.findByText("No series yet")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "New series" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("navigation", { name: "Pagination" })).toBeNull();
  });

  it("debounces search by 300ms, resets to page one and reports no matches", async () => {
    fakeTime();
    mockApi.get("/v1/admin/series", page([item(1)]));
    renderPage(<DramasPage />);
    const u = userEvent.setup({ delay: null });
    await screen.findByText("Hindi 1");
    mockApi.get("/v1/admin/series", (c) => (c.query.q === "zzz" ? page([]) : page([item(1)])));
    await u.type(screen.getByLabelText("Search title or slug…"), "zzz");
    expect(mockApi.callsTo("GET", "/v1/admin/series")).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(299);
    });
    expect(mockApi.callsTo("GET", "/v1/admin/series")).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });
    expect(await screen.findByText("No series match")).toBeInTheDocument();
    expect(screen.getByText("Try a different search or filter.")).toBeInTheDocument();
    expect(lastQuery()).toMatchObject({ q: "zzz", offset: "0" });
    // only the header link remains: the empty-state "create your first" action is for unfiltered lists
    expect(screen.getAllByRole("link", { name: /New series/ })).toHaveLength(1);
  });

  it("filters by status", async () => {
    mockApi.get("/v1/admin/series", page([item(1)]));
    renderPage(<DramasPage />);
    await screen.findByText("Hindi 1");
    await userEvent.selectOptions(screen.getByLabelText("Status filter"), "review");
    await waitFor(() => expect(lastQuery()).toMatchObject({ status: "review", offset: "0" }));
  });

  it("sorts server-side, toggling direction, and returns to the first page", async () => {
    mockApi.get("/v1/admin/series", (c) => page([item(1), item(2)], 45 + Number(c.query.offset) * 0));
    renderPage(<DramasPage />);
    await screen.findByText("Hindi 1");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(lastQuery()).toMatchObject({ offset: "20" }));
    await userEvent.click(screen.getByRole("button", { name: /^Views/ }));
    await waitFor(() => expect(lastQuery()).toMatchObject({ sort: "view_count", order: "asc", offset: "0" }));
    await userEvent.click(screen.getByRole("button", { name: /^Views/ }));
    await waitFor(() => expect(lastQuery()).toMatchObject({ sort: "view_count", order: "desc" }));
    expect(screen.getByRole("columnheader", { name: /Views/ })).toHaveAttribute("aria-sort", "descending");
  });

  it("paginates with a real total", async () => {
    mockApi.get("/v1/admin/series", (c) => page(c.query.offset === "40" ? [1, 2, 3, 4, 5].map((n) => item(n)) : [item(1)], 45));
    renderPage(<DramasPage />);
    expect(await screen.findByText(/1–1 of 45 · page 1 of 3/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Last" }));
    await waitFor(() => expect(lastQuery()).toMatchObject({ offset: "40" }));
    expect(await screen.findByText(/41–45 of 45 · page 3 of 3/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("explains an empty page past the end", async () => {
    mockApi.get("/v1/admin/series", (c) => (c.query.offset === "0" ? page([item(1)], 45) : page([], 45)));
    renderPage(<DramasPage />);
    await screen.findByText("Hindi 1");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Nothing on this page")).toBeInTheDocument();
    expect(screen.getByText("Go back a page.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "First" }));
    expect(await screen.findByText("Hindi 1")).toBeInTheDocument();
  });

  it("shows a retryable error when the first load fails", async () => {
    mockApi.get("/v1/admin/series", fail(500, "list down"));
    renderPage(<DramasPage />);
    expect(await screen.findByText("list down")).toBeInTheDocument();
    mockApi.get("/v1/admin/series", page([item(1)]));
    await userEvent.click(screen.getByRole("button", { name: /Retry|Try again/i }));
    expect(await screen.findByText("Hindi 1")).toBeInTheDocument();
  });

  it("keeps the table and shows an inline error when a refresh fails", async () => {
    mockApi.get("/v1/admin/series", page([item(1)], 45));
    renderPage(<DramasPage />);
    await screen.findByText("Hindi 1");
    mockApi.get("/v1/admin/series", fail(500, "flaky"));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("flaky")).toBeInTheDocument();
    expect(screen.getByText("Hindi 1")).toBeInTheDocument();
  });

  it("shows 'Refreshing…' while the next page loads", async () => {
    mockApi.get("/v1/admin/series", page([item(1)], 45));
    renderPage(<DramasPage />);
    await screen.findByText("Hindi 1");
    mockApi.get("/v1/admin/series", () => new Promise(() => {}));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Refreshing…")).toBeInTheDocument();
  });

  describe("delete", () => {
    it("confirms and deletes, then refetches", async () => {
      mockApi.get("/v1/admin/series", page([item(1), item(2)]));
      mockApi.delete("/v1/admin/series/s2", undefined);
      renderPage(<DramasPage />);
      await screen.findByText("Hindi 1");
      await userEvent.click(screen.getByRole("button", { name: "Delete Hindi 2" }));
      const dlg = within(screen.getByRole("dialog", { name: "Delete series" }));
      expect(dlg.getByText("Delete “Hindi 2” and all of its episodes? This cannot be undone.")).toBeInTheDocument();
      await userEvent.click(dlg.getByRole("button", { name: "Delete" }));
      expect(await screen.findByText("Deleted “Hindi 2”")).toBeInTheDocument();
      expect(mockApi.callsTo("DELETE", "/v1/admin/series/s2")).toHaveLength(1);
      await waitFor(() => expect(mockApi.callsTo("GET", "/v1/admin/series").length).toBe(2));
    });

    it("reports a failure and does not refetch", async () => {
      mockApi.get("/v1/admin/series", page([item(1)]));
      mockApi.delete("/v1/admin/series/s1", fail(409, "has purchases"));
      renderPage(<DramasPage />);
      await screen.findByText("Hindi 1");
      await userEvent.click(screen.getByRole("button", { name: "Delete Hindi 1" }));
      await userEvent.click(within(screen.getByRole("dialog", { name: "Delete series" })).getByRole("button", { name: "Delete" }));
      expect(await screen.findByText("has purchases")).toBeInTheDocument();
      expect(mockApi.callsTo("GET", "/v1/admin/series")).toHaveLength(1);
    });

    it("cancel closes the dialog without a request", async () => {
      mockApi.get("/v1/admin/series", page([item(1)]));
      renderPage(<DramasPage />);
      await screen.findByText("Hindi 1");
      await userEvent.click(screen.getByRole("button", { name: "Delete Hindi 1" }));
      await userEvent.click(within(screen.getByRole("dialog", { name: "Delete series" })).getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("dialog", { name: "Delete series" })).toBeNull();
      expect(mockApi.callsTo("DELETE")).toHaveLength(0);
    });
  });

  describe("re-embed all", () => {
    const open = async () => {
      mockApi.get("/v1/admin/series", page([item(1)]));
      renderPage(<DramasPage />);
      await screen.findByText("Hindi 1");
      await userEvent.click(screen.getByRole("button", { name: /Re-embed all/ }));
      return within(screen.getByRole("dialog", { name: "Refresh all embeddings" }));
    };

    it("queues the refresh", async () => {
      mockApi.post("/v1/admin/ai/reembed-all", { queued: true, job_id: "j9" });
      const dlg = await open();
      await userEvent.click(dlg.getByRole("button", { name: "Queue refresh" }));
      expect(await screen.findByText("Catalogue embedding refresh queued (job j9)")).toBeInTheDocument();
      expect(screen.queryByRole("dialog", { name: "Refresh all embeddings" })).toBeNull();
    });

    it("maps an AI outage to a readable error and keeps the dialog open", async () => {
      mockApi.post("/v1/admin/ai/reembed-all", fail(503, "off"));
      const dlg = await open();
      await userEvent.click(dlg.getByRole("button", { name: "Queue refresh" }));
      expect(await screen.findByText(/AI is unavailable right now/)).toBeInTheDocument();
      expect(screen.getByRole("dialog", { name: "Refresh all embeddings" })).toBeInTheDocument();
    });

    it("can be cancelled", async () => {
      const dlg = await open();
      await userEvent.click(dlg.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("dialog", { name: "Refresh all embeddings" })).toBeNull();
      expect(mockApi.callsTo("POST")).toHaveLength(0);
    });
  });
});
