import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import "@/test/admin-pages-dom";
import { fail, mockApi } from "@/test/api";
import { renderPage } from "@/test/render";
import ReportsPage from "./page";

const report = (n: number, over: Record<string, unknown> = {}) => ({
  id: `r${n}`,
  created_at: "2025-06-07T08:09:00Z",
  reporter_public_id: `REP${n}`,
  series_id: `s${n}`,
  series_title: `Series ${n}`,
  episode_id: null,
  reason: "bad_audio",
  details: null,
  status: "open",
  ...over,
});
const feed = (items: unknown[], total = items.length) => ({ items, total });
const calls = () => mockApi.callsTo("GET", "/v1/admin/reports");
const ue = userEvent.setup();

describe("ReportsPage listing", () => {
  it("shows open reports by default with reporter, content link, reason and details", async () => {
    mockApi.get(
      "/v1/admin/reports",
      feed(
        [
          report(1, { episode_id: "0123456789abcdef", details: "audio\ncuts out" }),
          report(2, { reporter_public_id: null, series_id: null, series_title: null, reason: "copyright_claim" }),
          report(3, { series_title: null }),
        ],
        9,
      ),
    );
    renderPage(<ReportsPage />);
    const link = await screen.findByRole("link", { name: "Series 1" });
    expect(link.getAttribute("href")).toBe("/dramas/s1");
    expect(calls()[0].query).toEqual({ status: "open", limit: "50", offset: "0", oldest_first: "false" });
    expect(screen.getByText("9 total")).toBeTruthy();
    expect(screen.getByText("episode 01234567…")).toBeTruthy();
    expect(screen.getByText(/audio\s+cuts out/)).toBeTruthy();
    expect(screen.getByText("anonymous")).toBeTruthy();
    expect(screen.getByText("copyright claim")).toBeTruthy(); // underscores become spaces
    expect(screen.getAllByText("bad audio")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Series" }).getAttribute("href")).toBe("/dramas/s3"); // fallback label
  });

  it("filters by status (including All), sorts oldest first, and resets to page one", async () => {
    mockApi.get("/v1/admin/reports", feed([report(1)], 120));
    renderPage(<ReportsPage />);
    await screen.findByText("Series 1");
    await ue.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(calls().at(-1)!.query.offset).toBe("50"));
    await ue.click(screen.getByRole("checkbox", { name: "Oldest first" }));
    await waitFor(() => expect(calls().at(-1)!.query).toMatchObject({ oldest_first: "true", offset: "0", status: "open" }));
    await ue.selectOptions(screen.getByLabelText("Status filter"), "resolved");
    await waitFor(() => expect(calls().at(-1)!.query.status).toBe("resolved"));
    await ue.selectOptions(screen.getByLabelText("Status filter"), "All");
    await waitFor(() => expect("status" in calls().at(-1)!.query).toBe(false));
  });

  it("changes the page size", async () => {
    mockApi.get("/v1/admin/reports", feed([report(1)], 300));
    renderPage(<ReportsPage />);
    await screen.findByText("Series 1");
    await ue.selectOptions(screen.getByRole("combobox", { name: "Rows per page" }), "100");
    await waitFor(() => expect(calls().at(-1)!.query).toMatchObject({ limit: "100", offset: "0" }));
  });

  it("has distinct empty states for open, other filters and later pages", async () => {
    mockApi.get("/v1/admin/reports", (c) => feed([], c.query.offset === "0" ? 0 : 80));
    renderPage(<ReportsPage />);
    expect(await screen.findByText("Inbox zero")).toBeTruthy();
    expect(screen.getByText("No open reports right now.")).toBeTruthy();
    await ue.selectOptions(screen.getByLabelText("Status filter"), "dismissed");
    expect(await screen.findByText("No reports")).toBeTruthy();
    expect(screen.queryByText("No open reports right now.")).toBeNull();
  });

  it("explains an empty later page", async () => {
    mockApi.get("/v1/admin/reports", (c) => (c.query.offset === "0" ? feed([report(1)], 80) : feed([], 80)));
    renderPage(<ReportsPage />);
    await screen.findByText("Series 1");
    await ue.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Nothing on this page")).toBeTruthy();
    expect(screen.getByText("Go back a page.")).toBeTruthy();
  });

  it("surfaces load errors, retries, and keeps stale rows under an inline error", async () => {
    mockApi.get("/v1/admin/reports", fail(500, "reports down"));
    renderPage(<ReportsPage />);
    expect(await screen.findByText("reports down")).toBeTruthy();
    mockApi.get("/v1/admin/reports", feed([report(1)]));
    await ue.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("Series 1");
    mockApi.get("/v1/admin/reports", fail(500, "stale now"));
    await ue.click(screen.getByRole("checkbox", { name: "Oldest first" }));
    expect(await screen.findByText("stale now")).toBeTruthy();
    expect(screen.getByText("Series 1")).toBeTruthy();
  });
});

describe("ReportsPage actions", () => {
  it("resolves an open report optimistically, then refetches so the filtered view settles", async () => {
    mockApi.get("/v1/admin/reports", feed([report(1), report(2)]));
    mockApi.put("/v1/admin/reports/r1", {});
    renderPage(<ReportsPage />);
    await screen.findByText("Series 1");
    mockApi.get("/v1/admin/reports", feed([report(2)]));
    await ue.click(screen.getAllByRole("button", { name: "Resolve" })[0]);
    expect(await screen.findByText("Report resolved")).toBeTruthy();
    expect(mockApi.callsTo("PUT", "/v1/admin/reports/r1")[0].body).toEqual({ status: "resolved" });
    await waitFor(() => expect(screen.queryByText("Series 1")).toBeNull());
    expect(calls()).toHaveLength(2);
  });

  it("dismisses and reopens", async () => {
    mockApi.get("/v1/admin/reports", feed([report(1)]));
    mockApi.put("/v1/admin/reports/r1", {});
    renderPage(<ReportsPage />);
    await screen.findByText("Series 1");
    await ue.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(await screen.findByText("Report dismissed")).toBeTruthy();
    mockApi.get("/v1/admin/reports", feed([report(1, { status: "dismissed" })]));
    await ue.selectOptions(screen.getByLabelText("Status filter"), "dismissed");
    await ue.click(await screen.findByRole("button", { name: "Reopen" }));
    await waitFor(() => expect(mockApi.callsTo("PUT", "/v1/admin/reports/r1").map((c) => c.body)).toEqual([{ status: "dismissed" }, { status: "open" }]));
  });

  it("rolls back only the failed row and reports the error", async () => {
    mockApi.get("/v1/admin/reports", feed([report(1), report(2)]));
    mockApi.put("/v1/admin/reports/r1", fail(500, "cannot update"));
    renderPage(<ReportsPage />);
    await screen.findByText("Series 1");
    await ue.click(screen.getAllByRole("button", { name: "Resolve" })[0]);
    expect(await screen.findByText("cannot update")).toBeTruthy();
    const rows = screen.getAllByRole("row");
    expect(within(rows[1]).getByText("open")).toBeTruthy();
    expect(within(rows[2]).getByText("open")).toBeTruthy();
    expect(calls()).toHaveLength(1);
  });
});
