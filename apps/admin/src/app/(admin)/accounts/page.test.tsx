import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/test/admin-pages-dom";
import { fail, mockApi } from "@/test/api";
import { setAdmin } from "@/test/auth";
import { renderPage } from "@/test/render";
import AccountsPage from "./page";

vi.mock("@/lib/auth", async () => (await import("@/test/auth")).authModule);

const acct = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  email: `${id}@example.com`,
  display_name: `Name ${id}`,
  role: "editor",
  is_active: true,
  totp_enabled: false,
  last_login_at: "2025-09-10T11:12:00Z",
  ...over,
});
const ue = userEvent.setup();
const rowOf = (name: string) => screen.getByText(name).closest("tr") as HTMLElement;

beforeEach(() => {
  setAdmin("owner", { id: "me", email: "me@example.com", totp_enabled: false });
});

describe("AccountsPage roster", () => {
  it("lists accounts with role, status, 2FA and last login, marking the signed-in admin", async () => {
    mockApi.get("/v1/admin/accounts", [
      acct("me", { role: "owner", totp_enabled: true }),
      acct("bob", { is_active: false, last_login_at: null }),
    ]);
    renderPage(<AccountsPage />);
    expect(screen.getByText(/Loading…/)).toBeTruthy();
    await screen.findByText("Name me");
    const me = within(rowOf("Name me"));
    expect(me.getByText("(you)")).toBeTruthy();
    expect(me.getByText("owner")).toBeTruthy();
    expect(me.getByText("on")).toBeTruthy();
    // You can edit yourself, but not sign yourself out or disable yourself.
    expect(me.getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(me.queryByRole("button", { name: "Sign out" })).toBeNull();
    expect(me.queryByRole("button", { name: "Disable" })).toBeNull();
    const bob = within(rowOf("Name bob"));
    expect(bob.getByText("disabled")).toBeTruthy();
    expect(bob.getByText("off")).toBeTruthy();
    expect(bob.getByText("—")).toBeTruthy();
    expect(bob.getByRole("button", { name: "Enable" })).toBeTruthy();
    expect(bob.queryByRole("button", { name: "Disable" })).toBeNull();
  });

  it("shows empty and error states", async () => {
    mockApi.get("/v1/admin/accounts", []);
    renderPage(<AccountsPage />);
    expect(await screen.findByText("No accounts")).toBeTruthy();
  });

  it("retries a failed load", async () => {
    mockApi.get("/v1/admin/accounts", fail(403, "forbidden"));
    renderPage(<AccountsPage />);
    expect(await screen.findByText("forbidden")).toBeTruthy();
    mockApi.get("/v1/admin/accounts", [acct("bob")]);
    await ue.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Name bob")).toBeTruthy();
  });

  it("reflects two-factor enrolment in the security card and refetches the roster", async () => {
    mockApi.get("/v1/admin/accounts", [acct("me", { role: "owner" })]);
    mockApi.post("/v1/admin/auth/totp/setup", { secret: "SECRET", otpauth_uri: "otpauth://x" });
    mockApi.post("/v1/admin/auth/totp/enable", undefined);
    renderPage(<AccountsPage />);
    await screen.findByText("Name me");
    await ue.click(screen.getByRole("button", { name: "Set up" }));
    const dlg = await screen.findByRole("dialog", { name: "Set up two-factor authentication" });
    await ue.type(within(dlg).getByLabelText(/Code from the app/), "123456");
    mockApi.get("/v1/admin/accounts", [acct("me", { role: "owner", totp_enabled: true })]);
    await ue.click(within(dlg).getByRole("button", { name: "Turn on" }));
    expect(await screen.findByRole("button", { name: "Turn off" })).toBeTruthy();
    expect(mockApi.callsTo("POST", "/v1/admin/auth/totp/enable")[0].body).toEqual({ secret: "SECRET", code: "123456" });
    await waitFor(() => expect(within(rowOf("Name me")).getByText("on")).toBeTruthy());
    expect(mockApi.callsTo("GET", "/v1/admin/accounts")).toHaveLength(2);
  });
});

describe("AccountsPage row actions", () => {
  it("disables an account after confirmation", async () => {
    mockApi.get("/v1/admin/accounts", [acct("me", { role: "owner" }), acct("bob")]);
    mockApi.delete("/v1/admin/accounts/bob", undefined);
    renderPage(<AccountsPage />);
    await screen.findByText("Name bob");
    await ue.click(within(rowOf("Name bob")).getByRole("button", { name: "Disable" }));
    const dlg = screen.getByRole("dialog", { name: "Disable account" });
    expect(within(dlg).getByText(/Disable bob@example\.com\?/)).toBeTruthy();
    mockApi.get("/v1/admin/accounts", [acct("me", { role: "owner" }), acct("bob", { is_active: false })]);
    await ue.click(within(dlg).getByRole("button", { name: "Disable" }));
    expect(await screen.findByText("Disabled bob@example.com")).toBeTruthy();
    expect(mockApi.callsTo("DELETE", "/v1/admin/accounts/bob")).toHaveLength(1);
    await waitFor(() => expect(within(rowOf("Name bob")).getByText("disabled")).toBeTruthy());
    expect(within(rowOf("Name me")).getByText("active")).toBeTruthy();
  });

  it("reports a failed disable and supports cancel", async () => {
    mockApi.get("/v1/admin/accounts", [acct("bob")]);
    mockApi.delete("/v1/admin/accounts/bob", fail(409, "last owner"));
    renderPage(<AccountsPage />);
    await screen.findByText("Name bob");
    await ue.click(screen.getByRole("button", { name: "Disable" }));
    await ue.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(mockApi.callsTo("DELETE")).toHaveLength(0);
    await ue.click(screen.getByRole("button", { name: "Disable" }));
    await ue.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Disable" }));
    expect(await screen.findByText("last owner")).toBeTruthy();
    expect(within(rowOf("Name bob")).getByText("active")).toBeTruthy();
  });

  it("re-enables an account in place", async () => {
    mockApi.get("/v1/admin/accounts", [acct("bob", { is_active: false })]);
    mockApi.put("/v1/admin/accounts/bob", (c) => acct("bob", { is_active: c.body.is_active }));
    renderPage(<AccountsPage />);
    await screen.findByText("Name bob");
    await ue.click(screen.getByRole("button", { name: "Enable" }));
    expect(await screen.findByText("Re-enabled bob@example.com")).toBeTruthy();
    expect(mockApi.callsTo("PUT", "/v1/admin/accounts/bob")[0].body).toEqual({ is_active: true });
    expect(within(rowOf("Name bob")).getByText("active")).toBeTruthy();
    expect(within(rowOf("Name bob")).getByRole("button", { name: "Disable" })).toBeTruthy();
  });

  it("reports a failed enable", async () => {
    mockApi.get("/v1/admin/accounts", [acct("bob", { is_active: false })]);
    mockApi.put("/v1/admin/accounts/bob", fail(500, "enable broke"));
    renderPage(<AccountsPage />);
    await screen.findByText("Name bob");
    await ue.click(screen.getByRole("button", { name: "Enable" }));
    expect(await screen.findByText("enable broke")).toBeTruthy();
    expect(within(rowOf("Name bob")).getByText("disabled")).toBeTruthy();
  });

  it("signs an account out everywhere after confirmation", async () => {
    mockApi.get("/v1/admin/accounts", [acct("bob")]);
    mockApi.post("/v1/admin/accounts/bob/revoke-sessions", acct("bob", { display_name: "Bob Renamed" }));
    renderPage(<AccountsPage />);
    await screen.findByText("Name bob");
    await ue.click(screen.getByRole("button", { name: "Sign out" }));
    const dlg = screen.getByRole("dialog", { name: "Sign out everywhere" });
    expect(within(dlg).getByText(/End every session for bob@example\.com\?/)).toBeTruthy();
    await ue.click(within(dlg).getByRole("button", { name: "Sign out" }));
    expect(await screen.findByText("Signed bob@example.com out everywhere")).toBeTruthy();
    expect(await screen.findByText("Bob Renamed")).toBeTruthy();
  });

  it("reports a failed session revoke and keeps the confirmation target cancellable", async () => {
    mockApi.get("/v1/admin/accounts", [acct("bob")]);
    mockApi.post("/v1/admin/accounts/bob/revoke-sessions", fail(500, "revoke broke"));
    renderPage(<AccountsPage />);
    await screen.findByText("Name bob");
    await ue.click(screen.getByRole("button", { name: "Sign out" }));
    await ue.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(mockApi.callsTo("POST", "/v1/admin/accounts/bob/revoke-sessions")).toHaveLength(0);
    await ue.click(screen.getByRole("button", { name: "Sign out" }));
    await ue.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Sign out" }));
    expect(await screen.findByText("revoke broke")).toBeTruthy();
  });
});

describe("AccountsPage create dialog", () => {
  it("validates every field before sending", async () => {
    mockApi.get("/v1/admin/accounts", []);
    renderPage(<AccountsPage />);
    await screen.findByText("No accounts");
    await ue.click(screen.getByRole("button", { name: /New account/ }));
    const dlg = screen.getByRole("dialog", { name: "New admin account" });
    await ue.type(within(dlg).getByLabelText(/Email/), "nope");
    await ue.type(within(dlg).getByLabelText(/Password/), "short");
    await ue.click(within(dlg).getByRole("button", { name: "Create" }));
    expect(within(dlg).getByText("Name is required.")).toBeTruthy();
    expect(within(dlg).getByText("Enter a valid email address.")).toBeTruthy();
    expect(within(dlg).getByText("Password must be at least 10 characters.")).toBeTruthy();
    expect(mockApi.callsTo("POST", "/v1/admin/accounts")).toHaveLength(0);
    await ue.type(within(dlg).getByLabelText(/Display name/), "N");
    expect(within(dlg).queryByText("Name is required.")).toBeNull();
  });

  it("explains each role and creates with a normalised email, appending the new row", async () => {
    mockApi.get("/v1/admin/accounts", [acct("me", { role: "owner" })]);
    mockApi.post("/v1/admin/accounts", (c) => acct("new", c.body));
    renderPage(<AccountsPage />);
    await screen.findByText("Name me");
    await ue.click(screen.getByRole("button", { name: /New account/ }));
    const dlg = screen.getByRole("dialog", { name: "New admin account" });
    expect(within(dlg).getByText("Dramas, categories, languages, pages.")).toBeTruthy(); // default role: editor
    await ue.selectOptions(within(dlg).getByLabelText("Role"), "finance");
    expect(within(dlg).getByText("Packs, purchases, users (coins/VIP), settings.")).toBeTruthy();
    await ue.type(within(dlg).getByLabelText(/Display name/), "  New Person ");
    await ue.type(within(dlg).getByLabelText(/Email/), " New@Example.COM ");
    await ue.type(within(dlg).getByLabelText(/Password/), "longenough-1");
    await ue.click(within(dlg).getByRole("button", { name: "Create" }));
    expect(await screen.findByText("Created new@example.com")).toBeTruthy();
    expect(mockApi.callsTo("POST", "/v1/admin/accounts")[0].body).toEqual({
      email: "new@example.com",
      display_name: "New Person",
      password: "longenough-1",
      role: "finance",
    });
    expect(await screen.findByText("New Person")).toBeTruthy();
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });

  it("can create an account while the roster is still loading", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    mockApi.get("/v1/admin/accounts", async () => {
      await gate;
      return [acct("me", { role: "owner" })];
    });
    mockApi.post("/v1/admin/accounts", (c) => acct("new", c.body));
    renderPage(<AccountsPage />);
    await ue.click(screen.getByRole("button", { name: /New account/ }));
    const dlg = screen.getByRole("dialog", { name: "New admin account" });
    await ue.type(within(dlg).getByLabelText(/Display name/), "Early");
    await ue.type(within(dlg).getByLabelText(/Email/), "early@example.com");
    await ue.type(within(dlg).getByLabelText(/Password/), "0123456789");
    await ue.click(within(dlg).getByRole("button", { name: "Create" }));
    await screen.findByText("Created early@example.com");
    release();
    await screen.findByText("Name me");
  });

  it("keeps the dialog on a failed create, and can be cancelled", async () => {
    mockApi.get("/v1/admin/accounts", []);
    mockApi.post("/v1/admin/accounts", fail(409, "email taken"));
    renderPage(<AccountsPage />);
    await screen.findByText("No accounts");
    await ue.click(screen.getByRole("button", { name: /New account/ }));
    let dlg = screen.getByRole("dialog");
    await ue.type(within(dlg).getByLabelText(/Display name/), "A");
    await ue.type(within(dlg).getByLabelText(/Email/), "a@b.co");
    await ue.type(within(dlg).getByLabelText(/Password/), "0123456789");
    await ue.click(within(dlg).getByRole("button", { name: "Create" }));
    expect(await screen.findByText("email taken")).toBeTruthy();
    dlg = screen.getByRole("dialog", { name: "New admin account" });
    await ue.click(within(dlg).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("AccountsPage edit dialog", () => {
  it("lets an owner change another account's name, role, status and password", async () => {
    mockApi.get("/v1/admin/accounts", [acct("me", { role: "owner" }), acct("bob")]);
    mockApi.put("/v1/admin/accounts/bob", (c) => acct("bob", { display_name: c.body.display_name, role: c.body.role, is_active: c.body.is_active }));
    renderPage(<AccountsPage />);
    await screen.findByText("Name bob");
    await ue.click(within(rowOf("Name bob")).getByRole("button", { name: "Edit" }));
    const dlg = screen.getByRole("dialog", { name: "Edit bob@example.com" });
    const name = within(dlg).getByLabelText(/Display name/);
    await ue.clear(name);
    await ue.type(name, " Bobby ");
    await ue.selectOptions(within(dlg).getByLabelText("Role"), "support");
    expect(within(dlg).getByText("Users, reports, inbox.")).toBeTruthy();
    await ue.click(within(dlg).getByRole("switch", { name: /Active/ }));
    await ue.type(within(dlg).getByLabelText("New password"), "brand-new-pass");
    await ue.click(within(dlg).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Account saved; password reset")).toBeTruthy();
    expect(mockApi.callsTo("PUT", "/v1/admin/accounts/bob")[0].body).toEqual({
      display_name: "Bobby",
      role: "support",
      is_active: false,
      password: "brand-new-pass",
    });
    expect(await screen.findByText("Bobby")).toBeTruthy();
  });

  it("omits role, status and an empty password when editing yourself", async () => {
    mockApi.get("/v1/admin/accounts", [acct("me", { role: "owner" })]);
    mockApi.put("/v1/admin/accounts/me", (c) => acct("me", { role: "owner", display_name: c.body.display_name }));
    renderPage(<AccountsPage />);
    await screen.findByText("Name me");
    await ue.click(screen.getByRole("button", { name: "Edit" }));
    const dlg = screen.getByRole("dialog");
    expect((within(dlg).getByLabelText("Role") as HTMLSelectElement).disabled).toBe(true);
    expect(within(dlg).getByText("You cannot change your own role.")).toBeTruthy();
    expect((within(dlg).getByRole("switch", { name: /Active/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(dlg).getByText("You cannot disable your own account.")).toBeTruthy();
    await ue.type(within(dlg).getByLabelText(/Display name/), "!");
    await ue.click(within(dlg).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Account saved")).toBeTruthy();
    expect(mockApi.callsTo("PUT", "/v1/admin/accounts/me")[0].body).toEqual({ display_name: "Name me!" });
  });

  it("validates name and password length, and clears errors on typing", async () => {
    mockApi.get("/v1/admin/accounts", [acct("bob")]);
    renderPage(<AccountsPage />);
    await screen.findByText("Name bob");
    await ue.click(screen.getByRole("button", { name: "Edit" }));
    const dlg = screen.getByRole("dialog");
    await ue.clear(within(dlg).getByLabelText(/Display name/));
    await ue.type(within(dlg).getByLabelText("New password"), "short");
    await ue.click(within(dlg).getByRole("button", { name: "Save" }));
    expect(within(dlg).getByText("Name is required.")).toBeTruthy();
    expect(within(dlg).getByText("New password must be at least 10 characters.")).toBeTruthy();
    expect(mockApi.callsTo("PUT")).toHaveLength(0);
    await ue.type(within(dlg).getByLabelText(/Display name/), "X");
    await ue.type(within(dlg).getByLabelText("New password"), "-long-enough");
    expect(within(dlg).queryByText("Name is required.")).toBeNull();
    expect(within(dlg).queryByText(/at least 10/)).toBeNull();
  });

  it("keeps the dialog on a failed save and closes on Cancel", async () => {
    mockApi.get("/v1/admin/accounts", [acct("bob")]);
    mockApi.put("/v1/admin/accounts/bob", fail(500, "edit broke"));
    renderPage(<AccountsPage />);
    await screen.findByText("Name bob");
    await ue.click(screen.getByRole("button", { name: "Edit" }));
    await ue.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("edit broke")).toBeTruthy();
    await ue.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
