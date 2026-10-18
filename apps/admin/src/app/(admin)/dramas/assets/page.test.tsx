import "@/test/dramas-dom-matchers";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fail, mockApi } from "@/test/api";
import { renderPage } from "@/test/render";
import AssetsPage from "./page";

const asset = (n: number, over: Record<string, unknown> = {}) => ({
  id: `a${n}`,
  source_key: `uploads/video-${n}.mp4`,
  status: "ready",
  duration_sec: 125,
  hls_master_key: `hls/${n}/master.m3u8`,
  error: null,
  ...over,
});
const list = (items: unknown[], counts: Record<string, number> = {}, total = items.length) => ({ items, total, counts });
const lastQuery = () => mockApi.callsTo("GET", "/v1/admin/uploads/videos").at(-1)?.query;
const fakeTime = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
afterEach(() => vi.useRealTimers());

describe("AssetsPage", () => {
  it("lists assets with duration, HLS key and errors", async () => {
    mockApi.get(
      "/v1/admin/uploads/videos",
      list(
        [asset(1), asset(2, { status: "failed", duration_sec: null, hls_master_key: null, error: "bad codec" })],
        { ready: 1, failed: 1 },
      ),
    );
    renderPage(<AssetsPage />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(await screen.findByText("uploads/video-1.mp4")).toBeInTheDocument();
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).getByText("2:05")).toBeInTheDocument();
    expect(within(rows[0]).getByText("hls/1/master.m3u8")).toHaveAttribute("title", "hls/1/master.m3u8");
    expect(within(rows[0]).queryByRole("button", { name: /Retry/ })).toBeNull();
    expect(within(rows[1]).getByText("bad codec")).toBeInTheDocument();
    expect(within(rows[1]).getByRole("button", { name: /Retry/ })).toBeInTheDocument();
    expect(within(rows[1]).getAllByText("—").length).toBeGreaterThanOrEqual(2);
    expect(lastQuery()).toEqual({ limit: "50", offset: "0" });
    // status filter shows tallies
    expect(screen.getByRole("option", { name: "All statuses (2)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "failed (1)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "queued (0)" })).toBeInTheDocument();
    expect(screen.queryByText(/Auto-refreshing/)).toBeNull();
  });

  it("surfaces failures in the header and jumps to the failed filter", async () => {
    mockApi.get("/v1/admin/uploads/videos", () => list([asset(1)], { ready: 4, failed: 3 }));
    renderPage(<AssetsPage />);
    const chip = await screen.findByRole("button", { name: /3 failed/ });
    await userEvent.click(chip);
    await waitFor(() => expect(lastQuery()).toMatchObject({ status: "failed", offset: "0" }));
    expect(screen.getByLabelText("Status filter")).toHaveValue("failed");
    expect(screen.queryByRole("button", { name: /3 failed/ })).toBeNull();
  });

  it("filters by status from the dropdown", async () => {
    mockApi.get("/v1/admin/uploads/videos", list([asset(1)], { ready: 1 }));
    renderPage(<AssetsPage />);
    await screen.findByText("uploads/video-1.mp4");
    await userEvent.selectOptions(screen.getByLabelText("Status filter"), "ready");
    await waitFor(() => expect(lastQuery()).toMatchObject({ status: "ready" }));
  });

  it("shows tailored empty states", async () => {
    mockApi.get("/v1/admin/uploads/videos", list([]));
    renderPage(<AssetsPage />);
    expect(await screen.findByText("No video assets")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Pagination" })).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText("Status filter"), "queued");
    expect(await screen.findByText("No queued assets")).toBeInTheDocument();
  });

  it("debounces the source-key search", async () => {
    fakeTime();
    mockApi.get("/v1/admin/uploads/videos", (c) => (c.query.q ? list([]) : list([asset(1)])));
    renderPage(<AssetsPage />);
    const u = userEvent.setup({ delay: null });
    await screen.findByText("uploads/video-1.mp4");
    await u.type(screen.getByLabelText("Search source key…"), "zzz");
    expect(mockApi.callsTo("GET", "/v1/admin/uploads/videos")).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(301);
    });
    expect(await screen.findByText("No matches")).toBeInTheDocument();
    expect(screen.getByText("No source key contains “zzz”.")).toBeInTheDocument();
    expect(lastQuery()).toMatchObject({ q: "zzz", offset: "0" });
  });

  it("paginates and changes the page size", async () => {
    mockApi.get("/v1/admin/uploads/videos", () => list([asset(1)], { ready: 120 }, 120));
    renderPage(<AssetsPage />);
    expect(await screen.findByText(/1–1 of 120 · page 1 of 3/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(lastQuery()).toMatchObject({ offset: "50", limit: "50" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Rows per page" }), "100");
    await waitFor(() => expect(lastQuery()).toMatchObject({ offset: "0", limit: "100" }));
  });

  it("shows a retryable error on first-load failure, and an inline one on refresh failure", async () => {
    mockApi.get("/v1/admin/uploads/videos", fail(500, "assets down"));
    const a = renderPage(<AssetsPage />);
    expect(await screen.findByText("assets down")).toBeInTheDocument();
    mockApi.get("/v1/admin/uploads/videos", list([asset(1)], { ready: 1 }));
    await userEvent.click(screen.getByRole("button", { name: /Retry|Try again/i }));
    await screen.findByText("uploads/video-1.mp4");
    mockApi.get("/v1/admin/uploads/videos", fail(500, "refresh failed"));
    await userEvent.click(screen.getByRole("button", { name: /Refresh/ }));
    expect(await screen.findByText("refresh failed")).toBeInTheDocument();
    expect(screen.getByText("uploads/video-1.mp4")).toBeInTheDocument();
    a.unmount();
  });

  it("Refresh refetches the list", async () => {
    mockApi.get("/v1/admin/uploads/videos", list([asset(1)], { ready: 1 }));
    renderPage(<AssetsPage />);
    await screen.findByText("uploads/video-1.mp4");
    await userEvent.click(screen.getByRole("button", { name: /Refresh/ }));
    await waitFor(() => expect(mockApi.callsTo("GET", "/v1/admin/uploads/videos")).toHaveLength(2));
  });

  it("auto-refreshes every 5s while transcodes are pending, and stops when they finish", async () => {
    fakeTime();
    let n = 0;
    mockApi.get("/v1/admin/uploads/videos", () => (++n < 3 ? list([asset(1, { status: "transcoding" })], { transcoding: 1 }) : list([asset(1)], { ready: 1 })));
    renderPage(<AssetsPage />);
    expect(await screen.findByText("Auto-refreshing while transcodes run")).toBeInTheDocument();
    // the poller ticks immediately (refetch #2) and then every 5s
    await vi.waitFor(() => expect(n).toBe(2));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    await vi.waitFor(() => expect(n).toBe(3));
    await vi.waitFor(() => expect(screen.queryByText(/Auto-refreshing/)).toBeNull());
    const settled = n;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });
    expect(n).toBe(settled);
  });

  describe("retry", () => {
    const failedList = () => list([asset(1), asset(2, { status: "failed", error: "x" })], { ready: 1, failed: 1 });

    it("re-queues a failed transcode and updates only that row", async () => {
      mockApi.get("/v1/admin/uploads/videos", failedList());
      mockApi.post("/v1/admin/uploads/videos/a2/retry", asset(2, { status: "queued", error: null }));
      renderPage(<AssetsPage />);
      await userEvent.click(await screen.findByRole("button", { name: /Retry/ }));
      expect(await screen.findByText("Transcode re-queued")).toBeInTheDocument();
      const rows = screen.getAllByRole("row").slice(1);
      expect(within(rows[1]).getByText("queued")).toBeInTheDocument();
      expect(within(rows[0]).getByText("ready")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
    });

    it("reports a retry failure", async () => {
      mockApi.get("/v1/admin/uploads/videos", failedList());
      mockApi.post("/v1/admin/uploads/videos/a2/retry", fail(500, "queue down"));
      renderPage(<AssetsPage />);
      await userEvent.click(await screen.findByRole("button", { name: /Retry/ }));
      expect(await screen.findByText("queue down")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Retry/ })).not.toBeDisabled();
    });
  });

  describe("delete", () => {
    const open = async () => {
      mockApi.get("/v1/admin/uploads/videos", list([asset(1)], { ready: 1 }));
      renderPage(<AssetsPage />);
      await userEvent.click(await screen.findByRole("button", { name: "Delete asset uploads/video-1.mp4" }));
      return within(screen.getByRole("dialog", { name: "Delete video asset" }));
    };

    it("deletes after confirmation and refetches", async () => {
      mockApi.delete("/v1/admin/uploads/videos/a1", undefined);
      const dlg = await open();
      expect(dlg.getByText(/Delete uploads\/video-1.mp4 and its transcoded output/)).toBeInTheDocument();
      await userEvent.click(dlg.getByRole("button", { name: "Delete" }));
      expect(await screen.findByText("Asset deleted")).toBeInTheDocument();
      expect(screen.queryByRole("dialog", { name: "Delete video asset" })).toBeNull();
      await waitFor(() => expect(mockApi.callsTo("GET", "/v1/admin/uploads/videos")).toHaveLength(2));
    });

    it("keeps the dialog open with guidance when the asset is in use", async () => {
      mockApi.delete("/v1/admin/uploads/videos/a1", fail(409, { code: "asset_in_use", message: "Attached to episode 3" }));
      const dlg = await open();
      await userEvent.click(dlg.getByRole("button", { name: "Delete" }));
      expect(await dlg.findByText(/Attached to episode 3 Detach it from the episode first, then delete\./)).toBeInTheDocument();
      expect(screen.queryByText("Asset deleted")).toBeNull();
      // cancelling clears the guidance for the next attempt
      await userEvent.click(dlg.getByRole("button", { name: "Cancel" }));
      await userEvent.click(screen.getByRole("button", { name: "Delete asset uploads/video-1.mp4" }));
      expect(within(screen.getByRole("dialog", { name: "Delete video asset" })).getByText(/and its transcoded output/)).toBeInTheDocument();
    });

    it("toasts other delete errors", async () => {
      mockApi.delete("/v1/admin/uploads/videos/a1", fail(500, "storage down"));
      const dlg = await open();
      await userEvent.click(dlg.getByRole("button", { name: "Delete" }));
      expect(await screen.findByText("storage down")).toBeInTheDocument();
      expect(screen.getByRole("dialog", { name: "Delete video asset" })).toBeInTheDocument();
    });

    it("cancel sends nothing", async () => {
      const dlg = await open();
      await userEvent.click(dlg.getByRole("button", { name: "Cancel" }));
      expect(mockApi.callsTo("DELETE")).toHaveLength(0);
    });
  });
});
