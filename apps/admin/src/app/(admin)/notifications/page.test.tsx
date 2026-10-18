import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import "@/test/admin-pages-dom";
import { fail, mockApi } from "@/test/api";
import { renderPage } from "@/test/render";
import NotificationsPage from "./page";

const note = (n: number, over: Record<string, unknown> = {}) => ({
  id: `n${n}`,
  title: `Title ${n}`,
  body: `Body ${n}`,
  segment: { all: true },
  sent_at: "2025-07-08T09:10:00Z",
  delivered: 40 + n,
  failed: n,
  ...over,
});
const ue = userEvent.setup();

async function fill(title: string, body: string) {
  await ue.type(screen.getByLabelText("Title"), title);
  await ue.type(screen.getByLabelText("Message"), body);
}

describe("NotificationsPage history", () => {
  it("lists past announcements with audience and delivery counts, queued ones with dashes", async () => {
    mockApi.get("/v1/admin/notifications", [
      note(1),
      note(2, { segment: { locale: "hi" } }),
      note(3, { sent_at: null, segment: null }),
    ]);
    renderPage(<NotificationsPage />);
    expect(screen.getByText(/Loading…/)).toBeTruthy();
    await screen.findByText("Title 1");
    expect(mockApi.callsTo("GET", "/v1/admin/notifications")[0].query).toEqual({ limit: "50" });
    const rows = screen.getAllByRole("row");
    expect(within(rows[1]).getByText("Everyone")).toBeTruthy();
    expect(within(rows[1]).getByText("41")).toBeTruthy();
    expect(within(rows[2]).getByText("hi")).toBeTruthy();
    const queued = within(rows[3]);
    expect(queued.getByText("Queued")).toBeTruthy();
    expect(queued.getAllByText("—")).toHaveLength(2);
    expect(queued.getByText("Everyone")).toBeTruthy();
  });

  it("shows an empty state", async () => {
    mockApi.get("/v1/admin/notifications", []);
    renderPage(<NotificationsPage />);
    expect(await screen.findByText("Nothing sent yet")).toBeTruthy();
  });

  it("shows an error that can be retried", async () => {
    mockApi.get("/v1/admin/notifications", fail(500, "push offline"));
    renderPage(<NotificationsPage />);
    expect(await screen.findByText("push offline")).toBeTruthy();
    mockApi.get("/v1/admin/notifications", [note(1)]);
    await ue.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Title 1")).toBeTruthy();
  });
});

describe("NotificationsPage compose", () => {
  const send = () => screen.getByRole("button", { name: "Send announcement" }) as HTMLButtonElement;

  it("keeps Send disabled until title and message are filled, and for a locale until a code is given", async () => {
    mockApi.get("/v1/admin/notifications", []);
    renderPage(<NotificationsPage />);
    await screen.findByText("Nothing sent yet");
    expect(send().disabled).toBe(true);
    await ue.type(screen.getByLabelText("Title"), "Hi");
    expect(send().disabled).toBe(true);
    await ue.type(screen.getByLabelText("Message"), "There");
    expect(send().disabled).toBe(false);
    await ue.selectOptions(screen.getByLabelText("Audience"), "locale");
    expect(send().disabled).toBe(true);
    await ue.type(screen.getByLabelText("Language code"), "  ");
    expect(send().disabled).toBe(true);
    await ue.type(screen.getByLabelText("Language code"), "ta");
    expect(send().disabled).toBe(false);
  });

  it("does nothing on submit when the form is incomplete", async () => {
    mockApi.get("/v1/admin/notifications", []);
    renderPage(<NotificationsPage />);
    await screen.findByText("Nothing sent yet");
    await ue.type(screen.getByLabelText("Title"), "Only title");
    fireEvent.submit(screen.getByLabelText("Title").closest("form")!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks for confirmation naming the audience, then sends to everyone and prepends the result", async () => {
    mockApi.get("/v1/admin/notifications", [note(1)]);
    mockApi.post("/v1/admin/notifications", (c) => ({ id: "new", sent_at: null, delivered: 0, failed: 0, ...c.body }));
    renderPage(<NotificationsPage />);
    await screen.findByText("Title 1");
    await fill("  Tonight  ", " 8pm drop ");
    await ue.click(send());
    const dlg = screen.getByRole("dialog", { name: "Send to every device?" });
    expect(within(dlg).getByText(/"Tonight" goes to everyone active in the last 30 days\./)).toBeTruthy();
    expect(mockApi.callsTo("POST")).toHaveLength(0);
    await ue.click(within(dlg).getByRole("button", { name: "Send now" }));
    expect(await screen.findByText("Queued. Delivery counts appear once the worker has finished.")).toBeTruthy();
    expect(mockApi.callsTo("POST", "/v1/admin/notifications")[0].body).toEqual({ title: "Tonight", body: "8pm drop", segment: { all: true } });
    const rows = screen.getAllByRole("row");
    expect(within(rows[1]).getByText("Tonight")).toBeTruthy();
    expect(within(rows[1]).getByText("Queued")).toBeTruthy();
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Message") as HTMLInputElement).value).toBe("");
  });

  it("targets one language", async () => {
    mockApi.get("/v1/admin/notifications", []);
    mockApi.post("/v1/admin/notifications", (c) => ({ id: "n9", sent_at: null, delivered: 0, failed: 0, ...c.body }));
    renderPage(<NotificationsPage />);
    await screen.findByText("Nothing sent yet");
    await fill("Namaste", "Naye episodes");
    await ue.selectOptions(screen.getByLabelText("Audience"), "locale");
    await ue.type(screen.getByLabelText("Language code"), " hi ");
    await ue.click(send());
    const dlg = screen.getByRole("dialog", { name: "Send to every device?" });
    expect(within(dlg).getByText(/goes to viewers using hi\./)).toBeTruthy();
    await ue.click(within(dlg).getByRole("button", { name: "Send now" }));
    await waitFor(() => expect(mockApi.callsTo("POST", "/v1/admin/notifications")[0].body.segment).toEqual({ locale: "hi" }));
    expect(await screen.findByText("hi")).toBeTruthy(); // audience cell of the new row
  });

  it("can be cancelled, and keeps the draft when the send fails", async () => {
    mockApi.get("/v1/admin/notifications", []);
    mockApi.post("/v1/admin/notifications", fail(500, "queue full"));
    renderPage(<NotificationsPage />);
    await screen.findByText("Nothing sent yet");
    await fill("Keep", "Me");
    await ue.click(send());
    await ue.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mockApi.callsTo("POST")).toHaveLength(0);
    await ue.click(send());
    await ue.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Send now" }));
    expect(await screen.findByText("queue full")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Keep");
    expect(screen.getByText("Nothing sent yet")).toBeTruthy();
  });

  it("can queue an announcement before the history has finished loading", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    mockApi.get("/v1/admin/notifications", async () => {
      await gate;
      return [];
    });
    mockApi.post("/v1/admin/notifications", (c) => ({ id: "n1", sent_at: null, delivered: 0, failed: 0, ...c.body }));
    renderPage(<NotificationsPage />);
    await fill("Early", "Bird");
    await ue.click(send());
    await ue.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Send now" }));
    await screen.findByText("Queued. Delivery counts appear once the worker has finished.");
    release();
    await screen.findByText("Nothing sent yet");
  });

  it("names the typed language in the confirmation", async () => {
    mockApi.get("/v1/admin/notifications", []);
    renderPage(<NotificationsPage />);
    await screen.findByText("Nothing sent yet");
    await fill("T", "B");
    await ue.selectOptions(screen.getByLabelText("Audience"), "locale");
    await ue.type(screen.getByLabelText("Language code"), "x");
    await ue.click(send());
    expect(within(screen.getByRole("dialog")).getByText(/viewers using x\./)).toBeTruthy();
  });
});
