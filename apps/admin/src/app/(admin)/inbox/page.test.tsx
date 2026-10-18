import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/test/admin-pages-dom";
import { fail, mockApi } from "@/test/api";
import { renderPage } from "@/test/render";
import InboxPage from "./page";

const msg = (n: number, over: Record<string, unknown> = {}) => ({
  id: `m${n}`,
  name: `Sender ${n}`,
  email: `s${n}@example.com`,
  subject: `Subject ${n}`,
  message: `Body of message ${n}`,
  is_read: false,
  replied_at: null,
  created_at: "2025-03-04T09:30:00Z",
  ...over,
});
const inbox = (items: unknown[], extra: Record<string, unknown> = {}) => ({ items, total: items.length, unread: items.length, ...extra });
const listCalls = () => mockApi.callsTo("GET", "/v1/admin/inbox");

let ue: ReturnType<typeof userEvent.setup>;
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  ue = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
});
afterEach(() => vi.useRealTimers());

describe("InboxPage listing", () => {
  it("lists messages with unread/total counts, subject fallback and replied badge", async () => {
    mockApi.get(
      "/v1/admin/inbox",
      inbox([msg(1, { replied_at: "2025-03-05T00:00:00Z", is_read: true }), msg(2, { subject: null, message: "x".repeat(150) })], { unread: 1, total: 7 }),
    );
    renderPage(<InboxPage />);
    expect(screen.getByText("Messages from the contact form.")).toBeTruthy();
    expect(await screen.findByText("1 unread · 7 messages")).toBeTruthy();
    expect(listCalls()[0].query).toEqual({ unread_only: "false", limit: "25", offset: "0" });
    expect(screen.getByText("replied")).toBeTruthy();
    expect(screen.getByText("Subject 1")).toBeTruthy();
    expect(screen.getByText("x".repeat(100))).toBeTruthy(); // truncated body stands in for a missing subject
  });

  it("shows empty states appropriate to the filter", async () => {
    mockApi.get("/v1/admin/inbox", inbox([]));
    renderPage(<InboxPage />);
    expect(await screen.findByText("Inbox is empty")).toBeTruthy();
    await ue.click(screen.getByRole("switch", { name: "Unread only" }));
    expect(await screen.findByText("No unread messages")).toBeTruthy();
    expect(listCalls().at(-1)!.query.unread_only).toBe("true");
    await ue.type(screen.getByRole("searchbox"), "zzz");
    await act(async () => void vi.advanceTimersByTime(300));
    expect(await screen.findByText("No matches")).toBeTruthy();
    expect(screen.getByText("Nothing matches “zzz”.")).toBeTruthy();
    expect(listCalls().at(-1)!.query.q).toBe("zzz");
  });

  it("shows a retryable error, and an inline one when stale data is on screen", async () => {
    mockApi.get("/v1/admin/inbox", fail(500, "inbox down"));
    renderPage(<InboxPage />);
    expect(await screen.findByText("inbox down")).toBeTruthy();
    mockApi.get("/v1/admin/inbox", inbox([msg(1)]));
    await ue.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("Subject 1");
    mockApi.get("/v1/admin/inbox", fail(500, "again"));
    await ue.click(screen.getByRole("switch", { name: "Unread only" }));
    expect(await screen.findByText("again")).toBeTruthy();
    expect(screen.getByText("Subject 1")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("again");
  });

  it("paginates and changes page size back to the first page", async () => {
    mockApi.get("/v1/admin/inbox", (c) => inbox([msg(Number(c.query.offset) + 1)], { total: 60 }));
    renderPage(<InboxPage />);
    await screen.findByText("Subject 1");
    await ue.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(listCalls().at(-1)!.query.offset).toBe("25"));
    await ue.selectOptions(screen.getByRole("combobox"), "50");
    await waitFor(() => expect(listCalls().at(-1)!.query).toMatchObject({ limit: "50", offset: "0" }));
  });
});

describe("InboxPage reading", () => {
  it("opens a message, marks it read optimistically and builds a reply link; closing does not re-mark", async () => {
    mockApi.get("/v1/admin/inbox", inbox([msg(1), msg(2)]));
    mockApi.put("/v1/admin/inbox/m1/read", undefined);
    renderPage(<InboxPage />);
    await ue.click(await screen.findByRole("button", { name: /^Sender 1/ }));
    expect(screen.getByText("Body of message 1")).toBeTruthy();
    expect(screen.getByText("1 unread · 2 messages")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Reply by email" }).getAttribute("href")).toBe("mailto:s1@example.com?subject=Re%3A%20Subject%201");
    await waitFor(() => expect(mockApi.callsTo("PUT", "/v1/admin/inbox/m1/read")).toHaveLength(1));
    await ue.click(screen.getByRole("button", { name: /^Sender 1/ }));
    expect(screen.queryByText("Body of message 1")).toBeNull();
    await ue.click(screen.getByRole("button", { name: /^Sender 1/ }));
    expect(mockApi.callsTo("PUT", "/v1/admin/inbox/m1/read")).toHaveLength(1); // already read
  });

  it("uses a generic reply subject when there is none", async () => {
    mockApi.get("/v1/admin/inbox", inbox([msg(1, { subject: null, is_read: true })]));
    renderPage(<InboxPage />);
    await ue.click(await screen.findByRole("button", { name: /^Sender 1/ }));
    expect(screen.getByRole("link", { name: "Reply by email" }).getAttribute("href")).toBe("mailto:s1@example.com?subject=Re%3A%20your%20message");
  });

  it("rolls the unread state and count back when marking read fails", async () => {
    mockApi.get("/v1/admin/inbox", inbox([msg(1), msg(2)]));
    mockApi.put("/v1/admin/inbox/m1/read", fail(500, "cannot mark"));
    renderPage(<InboxPage />);
    await ue.click(await screen.findByRole("button", { name: /^Sender 1/ }));
    expect(await screen.findByText("cannot mark")).toBeTruthy();
    expect(screen.getByText("2 unread · 2 messages")).toBeTruthy();
  });
});

describe("InboxPage deleting", () => {
  it("confirms by name, deletes and refetches", async () => {
    mockApi.get("/v1/admin/inbox", inbox([msg(1)]));
    mockApi.delete("/v1/admin/inbox/m1", undefined);
    renderPage(<InboxPage />);
    await ue.click(await screen.findByRole("button", { name: "Delete message from Sender 1" }));
    const dlg = screen.getByRole("dialog", { name: "Delete message" });
    expect(within(dlg).getByText("Delete the message from Sender 1? This cannot be undone.")).toBeTruthy();
    mockApi.get("/v1/admin/inbox", inbox([]));
    await ue.click(within(dlg).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Message deleted")).toBeTruthy();
    expect(await screen.findByText("Inbox is empty")).toBeTruthy();
    expect(mockApi.callsTo("DELETE", "/v1/admin/inbox/m1")).toHaveLength(1);
  });

  it("can be cancelled, and reports a failed delete without refetching", async () => {
    mockApi.get("/v1/admin/inbox", inbox([msg(1)]));
    mockApi.delete("/v1/admin/inbox/m1", fail(500, "nope"));
    renderPage(<InboxPage />);
    await ue.click(await screen.findByRole("button", { name: "Delete message from Sender 1" }));
    await ue.click(within(screen.getByRole("dialog", { name: "Delete message" })).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mockApi.callsTo("DELETE")).toHaveLength(0);
    await ue.click(screen.getByRole("button", { name: "Delete message from Sender 1" }));
    await ue.click(within(screen.getByRole("dialog", { name: "Delete message" })).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("nope")).toBeTruthy();
    expect(listCalls()).toHaveLength(1);
    expect(screen.getByText("Subject 1")).toBeTruthy();
  });
});
