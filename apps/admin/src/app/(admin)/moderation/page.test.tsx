import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@/test/dialog-polyfill";
import { fail, mockApi } from "@/test/api";
import { renderPage } from "@/test/render";
import ModerationPage from "./page";

type Item = {
  kind: "report" | "flagged_series";
  id: string;
  series_id: string | null;
  series_title: string | null;
  series_status: string | null;
  reason: string;
  details: string | null;
  created_at: string;
};
const r1: Item = { kind: "report", id: "r1", series_id: "s1", series_title: "Show A", series_status: "published", reason: "spam_content", details: "line one", created_at: "2026-01-02T03:04:05Z" };
const r2: Item = { kind: "report", id: "r2", series_id: null, series_title: null, series_status: null, reason: "other", details: null, created_at: "2026-01-03T03:04:05Z" };
const f1: Item = { kind: "flagged_series", id: "f1", series_id: "s2", series_title: "Show B", series_status: "published", reason: "violence, nudity,", details: "AI note", created_at: "2026-01-04T03:04:05Z" };
const f2: Item = { kind: "flagged_series", id: "f2", series_id: "s3", series_title: "Show C", series_status: "draft", reason: "gore", details: null, created_at: "2026-01-05T03:04:05Z" };
const f3: Item = { kind: "flagged_series", id: "f3", series_id: "s4", series_title: "Show D", series_status: "review", reason: "x", details: null, created_at: "2026-01-06T03:04:05Z" };

function page(items: Item[], over: Record<string, unknown> = {}) {
  return { items, total: items.length, reports: items.filter((i) => i.kind === "report").length, flagged: items.filter((i) => i.kind === "flagged_series").length, ...over };
}
function rowOf(label: string) {
  return screen.getByLabelText(label).closest("tr") as HTMLElement;
}

describe("ModerationPage list", () => {
  it("renders loading, then rows with type, series link, reasons, details and tab counts", async () => {
    mockApi.get("/v1/admin/moderation", page([r1, r2, f1]));
    renderPage(<ModerationPage />);
    expect(screen.getByText(/Loading/i)).toBeTruthy();
    await screen.findByText("Show A");
    expect(screen.getByRole("tab", { name: /All/ }).textContent).toContain("3");
    expect(screen.getByRole("tab", { name: /Reports/ }).textContent).toContain("2");
    expect(screen.getByRole("tab", { name: /AI-flagged/ }).textContent).toContain("1");
    const a = rowOf("Select Show A");
    expect(within(a).getByRole("link", { name: "Show A" }).getAttribute("href")).toBe("/dramas/s1");
    expect(within(a).getByText("spam content")).toBeTruthy();
    expect(within(a).getByText("line one")).toBeTruthy();
    expect(within(a).getByText("published")).toBeTruthy();
    expect(within(a).getByText("report")).toBeTruthy();
    // report without a series
    const b = rowOf("Select other");
    expect(within(b).getByText("—")).toBeTruthy();
    // flagged series splits comma separated reasons into badges
    const f = rowOf("Select Show B");
    expect(within(f).getByText("violence")).toBeTruthy();
    expect(within(f).getByText("nudity")).toBeTruthy();
    expect(within(f).getByText("AI flag")).toBeTruthy();
    expect(within(f).getByRole("link", { name: /Open/ }).getAttribute("href")).toBe("/dramas/s2");
    expect(mockApi.callsTo("GET", "/v1/admin/moderation")[0].query).toEqual({ limit: "50", offset: "0" });
  });

  it("uses fallback titles for untitled linked series", async () => {
    mockApi.get("/v1/admin/moderation", page([{ ...r1, series_title: null }]));
    renderPage(<ModerationPage />);
    expect(await screen.findByRole("link", { name: "Untitled series" })).toBeTruthy();
  });

  it("shows the all-clear empty state, and a bucket-specific one on a filter", async () => {
    mockApi.get("/v1/admin/moderation", page([]));
    renderPage(<ModerationPage />);
    expect(await screen.findByText("No open reports or flagged series.")).toBeTruthy();
    await userEvent.click(screen.getByRole("tab", { name: /Reports/ }));
    expect(await screen.findByText("Nothing in this bucket.")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Pagination" })).toBeNull();
  });

  it("shows an error with retry", async () => {
    mockApi.get("/v1/admin/moderation", fail(500, "queue offline"));
    renderPage(<ModerationPage />);
    expect(await screen.findByText("queue offline")).toBeTruthy();
    mockApi.get("/v1/admin/moderation", page([r1]));
    await userEvent.click(screen.getByRole("button", { name: /retry|try again/i }));
    expect(await screen.findByText("Show A")).toBeTruthy();
  });

  it("keeps rows and shows an inline error when a refresh fails, via the Refresh button", async () => {
    mockApi.get("/v1/admin/moderation", page([r1]));
    renderPage(<ModerationPage />);
    await screen.findByText("Show A");
    mockApi.get("/v1/admin/moderation", fail(500, "flaky"));
    await userEvent.click(screen.getByRole("button", { name: /Refresh/ }));
    expect(await screen.findByText("flaky")).toBeTruthy();
    expect(screen.getByText("Show A")).toBeTruthy();
  });

  it("requests the chosen kind and resets the offset when switching tabs", async () => {
    mockApi.get("/v1/admin/moderation", (c) => page([c.query.kind === "report" ? r1 : f1], { total: 120, reports: 60, flagged: 60 }));
    renderPage(<ModerationPage />);
    await screen.findByText("Show B");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(mockApi.callsTo("GET", "/v1/admin/moderation").some((c) => c.query.offset === "50")).toBe(true));
    await userEvent.click(screen.getByRole("tab", { name: /Reports/ }));
    await screen.findByText("Show A");
    const last = mockApi.callsTo("GET", "/v1/admin/moderation").at(-1)!;
    expect(last.query).toEqual({ kind: "report", limit: "50", offset: "0" });
    await userEvent.click(screen.getByRole("tab", { name: /AI-flagged/ }));
    await waitFor(() => expect(mockApi.callsTo("GET", "/v1/admin/moderation").at(-1)!.query.kind).toBe("flagged_series"));
  });

  it("paginates and changes the page size", async () => {
    mockApi.get("/v1/admin/moderation", page([r1], { total: 120, reports: 120, flagged: 0 }));
    renderPage(<ModerationPage />);
    await screen.findByText("Show A");
    expect(screen.getByText(/of 120 · page 1 of 3/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(mockApi.callsTo("GET", "/v1/admin/moderation").at(-1)!.query.offset).toBe("50"));
    await userEvent.selectOptions(screen.getByLabelText("Rows per page"), "20");
    await waitFor(() => expect(mockApi.callsTo("GET", "/v1/admin/moderation").at(-1)!.query).toMatchObject({ limit: "20", offset: "0" }));
  });

  it("disables Unpublish for draft/review series", async () => {
    mockApi.get("/v1/admin/moderation", page([f1, f2, f3]));
    renderPage(<ModerationPage />);
    await screen.findByText("Show B");
    expect((within(rowOf("Select Show B")).getByRole("button", { name: "Unpublish" }) as HTMLButtonElement).disabled).toBe(false);
    expect((within(rowOf("Select Show C")).getByRole("button", { name: "Unpublish" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(rowOf("Select Show D")).getByRole("button", { name: "Unpublish" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("ModerationPage single actions", () => {
  it("resolves a report optimistically and sends the status", async () => {
    mockApi.get("/v1/admin/moderation", page([r1, r2]));
    mockApi.put("/v1/admin/reports/r1", { ok: true });
    renderPage(<ModerationPage />);
    await screen.findByText("Show A");
    await userEvent.click(within(rowOf("Select Show A")).getByRole("button", { name: "Resolve" }));
    await waitFor(() => expect(screen.queryByText("Show A")).toBeNull());
    expect(mockApi.callsTo("PUT", "/v1/admin/reports/r1")[0].body).toEqual({ status: "resolved" });
    expect(await screen.findByText("Report resolved")).toBeTruthy();
  });

  it("dismisses a report", async () => {
    mockApi.get("/v1/admin/moderation", page([r2]));
    mockApi.put("/v1/admin/reports/r2", { ok: true });
    renderPage(<ModerationPage />);
    await screen.findByLabelText("Select other");
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(await screen.findByText("Report dismissed")).toBeTruthy();
    expect(mockApi.callsTo("PUT", "/v1/admin/reports/r2")[0].body).toEqual({ status: "dismissed" });
    expect(await screen.findByText("Queue is clear")).toBeTruthy();
  });

  it("puts the report back when the update fails", async () => {
    mockApi.get("/v1/admin/moderation", page([r1, r2]));
    mockApi.put("/v1/admin/reports/r1", fail(500, "cannot update"));
    renderPage(<ModerationPage />);
    await screen.findByText("Show A");
    await userEvent.click(within(rowOf("Select Show A")).getByRole("button", { name: "Resolve" }));
    expect(await screen.findByText("cannot update")).toBeTruthy();
    expect(screen.getByText("Show A")).toBeTruthy();
  });

  it("clears flags after confirmation and drops the row", async () => {
    mockApi.get("/v1/admin/moderation", page([f1, r1]));
    mockApi.post("/v1/admin/moderation/series/s2", { ok: true });
    renderPage(<ModerationPage />);
    await screen.findByText("Show B");
    await userEvent.click(within(rowOf("Select Show B")).getByRole("button", { name: "Clear flags" }));
    expect(screen.getByText(/Clear the AI flags on “Show B”\?/)).toBeTruthy();
    await userEvent.click(screen.getAllByRole("button", { name: "Clear flags" }).at(-1)!);
    await waitFor(() => expect(screen.queryByLabelText("Select Show B")).toBeNull());
    expect(mockApi.callsTo("POST", "/v1/admin/moderation/series/s2")[0].body).toEqual({ action: "clear_flags" });
    expect(await screen.findByText("Flags cleared on “Show B”")).toBeTruthy();
  });

  it("unpublishes after confirmation and refetches", async () => {
    mockApi.get("/v1/admin/moderation", page([f1]));
    mockApi.post("/v1/admin/moderation/series/s2", { ok: true });
    renderPage(<ModerationPage />);
    await screen.findByText("Show B");
    await userEvent.click(screen.getByRole("button", { name: "Unpublish" }));
    expect(screen.getByText(/Move “Show B” back to review\?/)).toBeTruthy();
    const gets = mockApi.callsTo("GET", "/v1/admin/moderation").length;
    await userEvent.click(screen.getAllByRole("button", { name: "Unpublish" }).at(-1)!);
    expect(await screen.findByText("“Show B” moved to review")).toBeTruthy();
    expect(mockApi.callsTo("POST", "/v1/admin/moderation/series/s2")[0].body).toEqual({ action: "unpublish" });
    await waitFor(() => expect(mockApi.callsTo("GET", "/v1/admin/moderation").length).toBe(gets + 1));
  });

  it("keeps the confirmation open when the action fails and Cancel closes it", async () => {
    mockApi.get("/v1/admin/moderation", page([f1]));
    mockApi.post("/v1/admin/moderation/series/s2", fail(409, "already moved"));
    renderPage(<ModerationPage />);
    await screen.findByText("Show B");
    await userEvent.click(screen.getByRole("button", { name: "Unpublish" }));
    await userEvent.click(screen.getAllByRole("button", { name: "Unpublish" }).at(-1)!);
    expect(await screen.findByText("already moved")).toBeTruthy();
    expect(screen.getByText(/Move “Show B” back to review/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByText(/Move “Show B” back to review/)).toBeNull());
  });

  it("uses generic copy for a series with no title and no series id does nothing", async () => {
    mockApi.get("/v1/admin/moderation", page([{ ...f1, series_title: null }]));
    mockApi.post("/v1/admin/moderation/series/s2", { ok: true });
    renderPage(<ModerationPage />);
    await screen.findByLabelText("Select violence, nudity,");
    await userEvent.click(screen.getByRole("button", { name: "Unpublish" }));
    expect(screen.getByText(/Move “this series” back to review/)).toBeTruthy();
    await userEvent.click(screen.getAllByRole("button", { name: "Unpublish" }).at(-1)!);
    expect(await screen.findByText("“Series” moved to review")).toBeTruthy();
  });

  it("clear-flags copy falls back for untitled series", async () => {
    mockApi.get("/v1/admin/moderation", page([{ ...f1, series_title: null }]));
    mockApi.post("/v1/admin/moderation/series/s2", { ok: true });
    renderPage(<ModerationPage />);
    await screen.findByLabelText("Select violence, nudity,");
    await userEvent.click(screen.getByRole("button", { name: "Clear flags" }));
    expect(screen.getByText(/Clear the AI flags on “this series”/)).toBeTruthy();
    await userEvent.click(screen.getAllByRole("button", { name: "Clear flags" }).at(-1)!);
    expect(await screen.findByText("Flags cleared on “Series”")).toBeTruthy();
  });

  it("does not call the API when a flagged item has no series id", async () => {
    mockApi.get("/v1/admin/moderation", page([{ ...f1, series_id: null }]));
    renderPage(<ModerationPage />);
    await screen.findByText("violence");
    expect(screen.queryByRole("link", { name: /Open/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Clear flags" }));
    await userEvent.click(screen.getAllByRole("button", { name: "Clear flags" }).at(-1)!);
    await waitFor(() => expect(screen.queryByText(/Clear the AI flags/)).not.toBeNull());
    expect(mockApi.callsTo("POST")).toHaveLength(0);
  });
});

describe("RatingDialog", () => {
  it("prefills the note, sends rating and trimmed note, and closes", async () => {
    mockApi.get("/v1/admin/moderation", page([f1]));
    mockApi.post("/v1/admin/moderation/series/s2", { ok: true });
    renderPage(<ModerationPage />);
    await screen.findByText("Show B");
    await userEvent.click(screen.getByRole("button", { name: "Set rating" }));
    expect(screen.getByText("Set rating · Show B")).toBeTruthy();
    expect((screen.getByLabelText(/Moderation note/) as HTMLTextAreaElement).value).toBe("AI note");
    expect((screen.getByLabelText(/Content rating/) as HTMLSelectElement).value).toBe("UA16");
    await userEvent.selectOptions(screen.getByLabelText(/Content rating/), "A");
    await userEvent.clear(screen.getByLabelText(/Moderation note/));
    await userEvent.type(screen.getByLabelText(/Moderation note/), "  adult  ");
    await userEvent.click(screen.getByRole("button", { name: "Save rating" }));
    expect(await screen.findByText("Rated A")).toBeTruthy();
    expect(mockApi.callsTo("POST", "/v1/admin/moderation/series/s2")[0].body).toEqual({ action: "set_rating", content_rating: "A", note: "adult" });
    await waitFor(() => expect(screen.queryByText("Set rating · Show B")).toBeNull());
  });

  it("sends a null note when blank, and falls back for details and title", async () => {
    mockApi.get("/v1/admin/moderation", page([{ ...f2, series_title: null }]));
    mockApi.post("/v1/admin/moderation/series/s3", { ok: true });
    renderPage(<ModerationPage />);
    await screen.findByLabelText("Select gore");
    await userEvent.click(screen.getByRole("button", { name: "Set rating" }));
    expect(screen.getByText("Set rating · Series")).toBeTruthy();
    expect((screen.getByLabelText(/Moderation note/) as HTMLTextAreaElement).value).toBe("");
    await userEvent.click(screen.getByRole("button", { name: "Save rating" }));
    await screen.findByText("Rated UA16");
    expect(mockApi.callsTo("POST", "/v1/admin/moderation/series/s3")[0].body).toEqual({ action: "set_rating", content_rating: "UA16", note: null });
  });

  it("stays open on failure and Cancel closes it", async () => {
    mockApi.get("/v1/admin/moderation", page([f1]));
    mockApi.post("/v1/admin/moderation/series/s2", fail(500, "rating failed"));
    renderPage(<ModerationPage />);
    await screen.findByText("Show B");
    await userEvent.click(screen.getByRole("button", { name: "Set rating" }));
    await userEvent.click(screen.getByRole("button", { name: "Save rating" }));
    expect(await screen.findByText("rating failed")).toBeTruthy();
    expect(screen.getByText("Set rating · Show B")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByText("Set rating · Show B")).toBeNull());
  });

  it("shows the validation error when the rating is cleared", async () => {
    mockApi.get("/v1/admin/moderation", page([f1]));
    renderPage(<ModerationPage />);
    await screen.findByText("Show B");
    await userEvent.click(screen.getByRole("button", { name: "Set rating" }));
    const sel = screen.getByLabelText(/Content rating/) as HTMLSelectElement;
    // Force an empty value to exercise the guard (the UI never offers one).
    const opt = document.createElement("option");
    opt.value = "";
    sel.appendChild(opt);
    await userEvent.selectOptions(sel, "");
    await userEvent.click(screen.getByRole("button", { name: "Save rating" }));
    expect(screen.getByText("Pick a rating.")).toBeTruthy();
    expect(mockApi.callsTo("POST")).toHaveLength(0);
    await userEvent.selectOptions(sel, "U");
    expect(screen.queryByText("Pick a rating.")).toBeNull();
  });
});

describe("ModerationPage bulk actions", () => {
  async function loaded(items: Item[]) {
    mockApi.get("/v1/admin/moderation", page(items));
    renderPage(<ModerationPage />);
    await screen.findByLabelText("Select all in this queue");
  }

  it("selects all, shows per-type buttons and resolves selected reports one by one", async () => {
    await loaded([r1, r2, f1]);
    mockApi.put("/v1/admin/reports/*", { ok: true });
    await userEvent.click(screen.getByLabelText("Select all in this queue"));
    expect(screen.getByText("3 selected")).toBeTruthy();
    expect(screen.getByText("Each action applies to its own type only.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear flags on 1" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Resolve 2" }));
    expect(screen.getByText("Mark 2 reports as resolved? This cannot be undone from here.")).toBeTruthy();
    await userEvent.click(screen.getAllByRole("button", { name: "Resolve" }).at(-1)!);
    expect(await screen.findByText("2 items resolved")).toBeTruthy();
    expect(mockApi.callsTo("PUT", "/v1/admin/reports/*").map((c) => c.body)).toEqual([{ status: "resolved" }, { status: "resolved" }]);
    await waitFor(() => expect(screen.queryByText("3 selected")).toBeNull());
  });

  it("dismisses a single selected report with singular copy", async () => {
    await loaded([r1, f1]);
    mockApi.put("/v1/admin/reports/r1", { ok: true });
    await userEvent.click(screen.getByLabelText("Select Show A"));
    expect(screen.queryByText("Each action applies to its own type only.")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Dismiss 1" }));
    expect(screen.getByText("Mark 1 report as dismissed? This cannot be undone from here.")).toBeTruthy();
    await userEvent.click(screen.getAllByRole("button", { name: "Dismiss" }).at(-1)!);
    expect(await screen.findByText("1 item dismissed")).toBeTruthy();
  });

  it("clears flags in bulk, skipping flagged rows without a series id", async () => {
    await loaded([f1, f2, { ...f3, series_id: null }]);
    mockApi.post("/v1/admin/moderation/series/*", { ok: true });
    await userEvent.click(screen.getByLabelText("Select all in this queue"));
    await userEvent.click(screen.getByRole("button", { name: "Clear flags on 2" }));
    expect(screen.getByText(/Clear AI flags on 2 series\?/)).toBeTruthy();
    await userEvent.click(screen.getAllByRole("button", { name: "Clear flags" }).at(-1)!);
    expect(await screen.findByText("2 items cleared")).toBeTruthy();
    expect(mockApi.callsTo("POST", "/v1/admin/moderation/series/*").map((c) => c.path)).toEqual([
      "/v1/admin/moderation/series/s2",
      "/v1/admin/moderation/series/s3",
    ]);
  });

  it("reports partial failure and leaves only the failures selected", async () => {
    await loaded([r1, r2]);
    mockApi.put("/v1/admin/reports/r1", { ok: true });
    mockApi.put("/v1/admin/reports/r2", fail(500, "nope"));
    await userEvent.click(screen.getByLabelText("Select all in this queue"));
    await userEvent.click(screen.getByRole("button", { name: "Resolve 2" }));
    await userEvent.click(screen.getAllByRole("button", { name: "Resolve" }).at(-1)!);
    expect(await screen.findByText("1 item resolved")).toBeTruthy();
    expect(await screen.findByText("1 could not be updated and stay selected.")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("1 selected")).toBeTruthy());
    expect((screen.getByLabelText("Select other") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Select Show A") as HTMLInputElement).checked).toBe(false);
  });

  it("reports a total failure without a success toast", async () => {
    await loaded([f1]);
    mockApi.post("/v1/admin/moderation/series/s2", fail(500, "down"));
    await userEvent.click(screen.getByLabelText("Select Show B"));
    await userEvent.click(screen.getByRole("button", { name: "Clear flags on 1" }));
    await userEvent.click(screen.getAllByRole("button", { name: "Clear flags" }).at(-1)!);
    expect(await screen.findByText("1 could not be updated and stay selected.")).toBeTruthy();
    expect(screen.queryByText(/items? cleared/)).toBeNull();
  });

  it("cancel closes the bulk confirmation, Clear empties the selection, and tab/page changes clear it", async () => {
    mockApi.get("/v1/admin/moderation", page([r1, f1], { total: 120 }));
    renderPage(<ModerationPage />);
    await screen.findByLabelText("Select all in this queue");
    await userEvent.click(screen.getByLabelText("Select Show A"));
    await userEvent.click(screen.getByRole("button", { name: "Dismiss 1" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mockApi.callsTo("PUT")).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByText("1 selected")).toBeNull();

    await userEvent.click(screen.getByLabelText("Select Show A"));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.queryByText("1 selected")).toBeNull());
    await userEvent.click(screen.getByLabelText("Select Show B"));
    await userEvent.click(screen.getByRole("tab", { name: /AI-flagged/ }));
    await waitFor(() => expect(screen.queryByText("1 selected")).toBeNull());
  });

  it("an indeterminate header shows for a partial selection and toggling all off clears it", async () => {
    await loaded([r1, r2]);
    await userEvent.click(screen.getByLabelText("Select Show A"));
    expect((screen.getByLabelText("Select all in this queue") as HTMLInputElement).indeterminate).toBe(true);
    await userEvent.click(screen.getByLabelText("Select all in this queue"));
    await userEvent.click(screen.getByLabelText("Select all in this queue"));
    expect(screen.queryByText(/selected/)).toBeNull();
  });
});
