import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import "@/test/admin-pages-dom";
import { fail, mockApi } from "@/test/api";
import { renderPage } from "@/test/render";
import FlagsPage from "./page";

const flag = (key: string, over: Record<string, unknown> = {}) => ({
  key,
  enabled: false,
  rules: null,
  updated_at: "2025-08-09T10:11:00Z",
  updated_by: null,
  ...over,
});
const ue = userEvent.setup();
const rowOf = (key: string) => screen.getByText(key).closest("tr") as HTMLElement;

async function paste(el: HTMLElement, text: string) {
  await ue.click(el);
  await ue.paste(text);
}

describe("FlagsPage listing", () => {
  it("lists flags with rules, last editor and an 'everyone' fallback", async () => {
    mockApi.get("/v1/admin/flags", [
      flag("alpha", { enabled: true, rules: { percentage: 50 }, updated_by: "root@example.com" }),
      flag("beta", { rules: {} }),
    ]);
    renderPage(<FlagsPage />);
    expect(screen.getByText(/Loading…/)).toBeTruthy();
    await screen.findByText("alpha");
    expect(within(rowOf("alpha")).getByText('{"percentage":50}')).toBeTruthy();
    expect(within(rowOf("alpha")).getByText("by root@example.com")).toBeTruthy();
    expect(within(rowOf("alpha")).getByRole("switch", { name: "alpha enabled" }).getAttribute("aria-checked")).toBe("true");
    expect(within(rowOf("beta")).getByText("everyone")).toBeTruthy();
    expect(within(rowOf("beta")).queryByText(/^by /)).toBeNull();
  });

  it("shows an empty state", async () => {
    mockApi.get("/v1/admin/flags", []);
    renderPage(<FlagsPage />);
    expect(await screen.findByText("No flags")).toBeTruthy();
  });

  it("shows an error with retry", async () => {
    mockApi.get("/v1/admin/flags", fail(500, "flags down"));
    renderPage(<FlagsPage />);
    expect(await screen.findByText("flags down")).toBeTruthy();
    mockApi.get("/v1/admin/flags", [flag("alpha")]);
    await ue.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("alpha");
    expect(screen.queryByText("flags down")).toBeNull();
  });
});

describe("FlagsPage toggling", () => {
  it("asks before turning a flag on, then saves it keeping its rules", async () => {
    mockApi.get("/v1/admin/flags", [flag("alpha", { rules: { percentage: 10 } }), flag("zeta")]);
    mockApi.put("/v1/admin/flags/alpha", (c) => flag("alpha", { enabled: c.body.enabled, rules: c.body.rules, updated_by: "me" }));
    renderPage(<FlagsPage />);
    await screen.findByText("alpha");
    await ue.click(within(rowOf("alpha")).getByRole("switch"));
    const dlg = screen.getByRole("dialog", { name: "Turn flag on" });
    expect(within(dlg).getByText(/Turn “alpha” on\? Apps pick this up on their next config refresh, within the flag's rules\./)).toBeTruthy();
    expect(mockApi.callsTo("PUT")).toHaveLength(0);
    await ue.click(within(dlg).getByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(mockApi.callsTo("PUT", "/v1/admin/flags/alpha")[0].body).toEqual({ enabled: true, rules: { percentage: 10 } }));
    await waitFor(() => expect(within(rowOf("alpha")).getByRole("switch").getAttribute("aria-checked")).toBe("true"));
    expect(within(rowOf("alpha")).getByText("by me")).toBeTruthy();
    expect(within(rowOf("zeta")).getByRole("switch").getAttribute("aria-checked")).toBe("false");
  });

  it("uses plain wording for a flag without rules and a destructive confirm when turning off", async () => {
    mockApi.get("/v1/admin/flags", [flag("alpha", { enabled: true })]);
    mockApi.put("/v1/admin/flags/alpha", (c) => flag("alpha", { enabled: c.body.enabled }));
    renderPage(<FlagsPage />);
    await screen.findByText("alpha");
    await ue.click(within(rowOf("alpha")).getByRole("switch"));
    const dlg = screen.getByRole("dialog", { name: "Turn flag off" });
    expect(within(dlg).getByText("Turn “alpha” off? Apps pick this up on their next config refresh.")).toBeTruthy();
    await ue.click(within(dlg).getByRole("button", { name: "Turn off" }));
    await waitFor(() => expect(mockApi.callsTo("PUT", "/v1/admin/flags/alpha")[0].body).toEqual({ enabled: false, rules: null }));
  });

  it("mentions rules-only wording for a flag with an empty rules object", async () => {
    mockApi.get("/v1/admin/flags", [flag("alpha", { rules: {} })]);
    renderPage(<FlagsPage />);
    await screen.findByText("alpha");
    await ue.click(within(rowOf("alpha")).getByRole("switch"));
    expect(within(screen.getByRole("dialog")).getByText("Turn “alpha” on? Apps pick this up on their next config refresh.")).toBeTruthy();
  });

  it("can be cancelled without a request", async () => {
    mockApi.get("/v1/admin/flags", [flag("alpha")]);
    renderPage(<FlagsPage />);
    await screen.findByText("alpha");
    await ue.click(within(rowOf("alpha")).getByRole("switch"));
    await ue.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mockApi.callsTo("PUT")).toHaveLength(0);
  });

  it("rolls the switch back and reports a failed toggle", async () => {
    mockApi.get("/v1/admin/flags", [flag("alpha"), flag("beta")]);
    mockApi.put("/v1/admin/flags/alpha", fail(500, "cannot flip"));
    renderPage(<FlagsPage />);
    await screen.findByText("alpha");
    await ue.click(within(rowOf("alpha")).getByRole("switch"));
    await ue.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Turn on" }));
    expect(await screen.findByText("cannot flip")).toBeTruthy();
    expect(within(rowOf("alpha")).getByRole("switch").getAttribute("aria-checked")).toBe("false");
    expect((within(rowOf("alpha")).getByRole("switch") as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("FlagsPage deleting", () => {
  it("confirms and removes the flag", async () => {
    mockApi.get("/v1/admin/flags", [flag("alpha"), flag("beta")]);
    mockApi.delete("/v1/admin/flags/alpha", undefined);
    renderPage(<FlagsPage />);
    await screen.findByText("alpha");
    await ue.click(screen.getByRole("button", { name: "Delete alpha" }));
    const dlg = screen.getByRole("dialog", { name: "Delete flag" });
    expect(within(dlg).getByText("Delete “alpha”? Apps fall back to their built-in default for this flag.")).toBeTruthy();
    await ue.click(within(dlg).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Deleted alpha")).toBeTruthy();
    expect(screen.queryByText("alpha")).toBeNull();
    expect(screen.getByText("beta")).toBeTruthy();
  });

  it("keeps the flag and reports when deletion fails; cancel does nothing", async () => {
    mockApi.get("/v1/admin/flags", [flag("alpha")]);
    mockApi.delete("/v1/admin/flags/alpha", fail(409, "in use"));
    renderPage(<FlagsPage />);
    await screen.findByText("alpha");
    await ue.click(screen.getByRole("button", { name: "Delete alpha" }));
    await ue.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(mockApi.callsTo("DELETE")).toHaveLength(0);
    await ue.click(screen.getByRole("button", { name: "Delete alpha" }));
    await ue.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("in use")).toBeTruthy();
    expect(screen.getByText("alpha")).toBeTruthy();
  });
});

describe("FlagsPage create/edit dialog", () => {
  it("validates key and rules before sending anything", async () => {
    mockApi.get("/v1/admin/flags", []);
    renderPage(<FlagsPage />);
    await screen.findByText("No flags");
    await ue.click(screen.getByRole("button", { name: /New flag/ }));
    const dlg = screen.getByRole("dialog", { name: "New flag" });
    await ue.type(within(dlg).getByLabelText(/Key/), "X");
    await paste(within(dlg).getByLabelText("Rules (JSON)"), "[1]");
    await ue.click(within(dlg).getByRole("button", { name: "Create" }));
    expect(within(dlg).getByText("2–64 characters: lowercase letters, digits, _ . or -.")).toBeTruthy();
    expect(within(dlg).getAllByText('Must be a JSON object, e.g. { "key": 1 }').length).toBeGreaterThan(0);
    expect(mockApi.callsTo("PUT")).toHaveLength(0);
    await ue.type(within(dlg).getByLabelText(/Key/), "y"); // lower-cased on input, clears the key error
    expect(within(dlg).queryByText(/2–64 characters/)).toBeNull();
    expect((within(dlg).getByLabelText(/Key/) as HTMLInputElement).value).toBe("xy");
  });

  it("creates a flag with parsed rules and inserts it in key order", async () => {
    mockApi.get("/v1/admin/flags", [flag("zzz"), flag("aaa")]);
    mockApi.put("/v1/admin/flags/mid_flag", (c) => flag("mid_flag", { enabled: c.body.enabled, rules: c.body.rules }));
    renderPage(<FlagsPage />);
    await screen.findByText("zzz");
    await ue.click(screen.getByRole("button", { name: /New flag/ }));
    const dlg = screen.getByRole("dialog", { name: "New flag" });
    await ue.type(within(dlg).getByLabelText(/Key/), " Mid_Flag ");
    await ue.click(within(dlg).getByRole("switch", { name: /^Enabled/ }));
    await paste(within(dlg).getByLabelText("Rules (JSON)"), '{"platforms":["android"]}');
    await ue.click(within(dlg).getByRole("button", { name: "Create" }));
    expect(await screen.findByText("Flag created")).toBeTruthy();
    expect(mockApi.callsTo("PUT", "/v1/admin/flags/mid_flag")[0].body).toEqual({ enabled: true, rules: { platforms: ["android"] } });
    const keys = screen.getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0].textContent);
    expect(keys).toEqual(["aaa", "mid_flag", "zzz"]);
    expect(screen.queryByRole("dialog", { name: "New flag" })).toBeNull();
  });

  it("sends null rules when the editor is blank", async () => {
    mockApi.get("/v1/admin/flags", []);
    mockApi.put("/v1/admin/flags/solo", (c) => flag("solo", { rules: c.body.rules }));
    renderPage(<FlagsPage />);
    await screen.findByText("No flags");
    await ue.click(screen.getByRole("button", { name: /New flag/ }));
    const dlg = screen.getByRole("dialog");
    await ue.type(within(dlg).getByLabelText(/Key/), "solo");
    await ue.click(within(dlg).getByRole("button", { name: "Create" }));
    await screen.findByText("Flag created");
    expect(mockApi.callsTo("PUT", "/v1/admin/flags/solo")[0].body).toEqual({ enabled: false, rules: null });
  });

  it("edits an existing flag: key locked, rules prefilled, existing row replaced", async () => {
    mockApi.get("/v1/admin/flags", [flag("alpha", { enabled: true, rules: { percentage: 5 } })]);
    mockApi.put("/v1/admin/flags/alpha", (c) => flag("alpha", { enabled: c.body.enabled, rules: c.body.rules }));
    renderPage(<FlagsPage />);
    await screen.findByText("alpha");
    await ue.click(within(rowOf("alpha")).getByRole("button", { name: "Edit" }));
    const dlg = screen.getByRole("dialog", { name: "Edit alpha" });
    expect((within(dlg).getByLabelText(/Key/) as HTMLInputElement).disabled).toBe(true);
    const rules = within(dlg).getByLabelText("Rules (JSON)") as HTMLTextAreaElement;
    expect(JSON.parse(rules.value)).toEqual({ percentage: 5 });
    await ue.clear(rules);
    await paste(rules, '{"countries":["IN"]}');
    await ue.click(within(dlg).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Flag saved")).toBeTruthy();
    expect(mockApi.callsTo("PUT", "/v1/admin/flags/alpha")[0].body).toEqual({ enabled: true, rules: { countries: ["IN"] } });
    expect(screen.getAllByText("alpha")).toHaveLength(1);
    expect(screen.getByText('{"countries":["IN"]}')).toBeTruthy();
  });

  it("clears the rules error while typing and keeps the dialog open on a failed save", async () => {
    mockApi.get("/v1/admin/flags", []);
    mockApi.put("/v1/admin/flags/boom", fail(500, "save broke"));
    renderPage(<FlagsPage />);
    await screen.findByText("No flags");
    await ue.click(screen.getByRole("button", { name: /New flag/ }));
    const dlg = screen.getByRole("dialog");
    await ue.type(within(dlg).getByLabelText(/Key/), "boom");
    const rules = within(dlg).getByLabelText("Rules (JSON)");
    await paste(rules, "{bad");
    await ue.click(within(dlg).getByRole("button", { name: "Create" }));
    expect(within(dlg).getAllByText(/Invalid JSON/).length).toBeGreaterThan(0);
    await ue.clear(rules);
    await paste(rules, "{}");
    expect(within(dlg).queryByText(/Invalid JSON/)).toBeNull();
    await ue.click(within(dlg).getByRole("button", { name: "Create" }));
    expect(await screen.findByText("save broke")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "New flag" })).toBeTruthy();
    expect((within(dlg).getByRole("button", { name: "Create" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("closes with Cancel", async () => {
    mockApi.get("/v1/admin/flags", []);
    renderPage(<FlagsPage />);
    await screen.findByText("No flags");
    await ue.click(screen.getByRole("button", { name: /New flag/ }));
    await ue.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
