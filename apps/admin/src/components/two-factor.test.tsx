import "@/test/components-dom-matchers";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { installDialogPolyfill } from "@/test/components-dialog";
import { fail, mockApi } from "@/test/api";
import { renderPage } from "@/test/render";
import { getToken } from "@/lib/token";
import { fakeJwt } from "@/test/jwt";
import { TwoFactorCard } from "./two-factor";

beforeAll(installDialogPolyfill);

const dialog = () => document.querySelector("dialog[open]") as HTMLElement;

describe("TwoFactorCard: status", () => {
  it("off: warns and offers Set up", () => {
    renderPage(<TwoFactorCard enabled={false} onChange={() => {}} />);
    expect(screen.getByText("off")).toBeTruthy();
    expect(screen.getByText(/one password is all that stands/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Set up" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Turn off" })).toBeNull();
  });
  it("on: shows state and offers Turn off", () => {
    renderPage(<TwoFactorCard enabled onChange={() => {}} />);
    expect(screen.getByText("on")).toBeTruthy();
    expect(screen.getByText(/code from your authenticator app is required/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Turn off" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Set up" })).toBeNull();
  });
});

describe("enrolment", () => {
  const setup = { secret: "JBSWY3DPEHPK3PXP", otpauth_uri: "otpauth://totp/x" };

  it("fetches a candidate secret, shows it, and enables only with a code of 6+ digits", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    mockApi.post("/v1/admin/auth/totp/setup", setup);
    mockApi.post("/v1/admin/auth/totp/enable", { ok: true });
    renderPage(<TwoFactorCard enabled={false} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Set up" }));
    const d = await waitFor(() => {
      const el = dialog();
      expect(el).toBeTruthy();
      return el;
    });
    expect((within(d).getByLabelText("Setup key") as HTMLInputElement).value).toBe(setup.secret);
    expect((within(d).getByLabelText("Setup key") as HTMLInputElement).readOnly).toBe(true);
    const turnOn = within(d).getByRole("button", { name: "Turn on" });
    expect(turnOn).toBeDisabled();
    const code = within(d).getByLabelText(/Code from the app/);
    expect(document.activeElement).toBe(code);
    await user.type(code, "12345");
    expect(turnOn).toBeDisabled();
    await user.type(code, "6");
    expect(turnOn).toBeEnabled();
    await user.click(turnOn);
    await screen.findByText("Two-factor authentication is on");
    expect(mockApi.callsTo("POST", "/v1/admin/auth/totp/enable")[0].body).toEqual({ secret: setup.secret, code: "123456" });
    expect(onChange).toHaveBeenCalledWith(true);
    expect(dialog()).toBeNull();
  });

  it("selects the key on focus", async () => {
    const user = userEvent.setup();
    mockApi.post("/v1/admin/auth/totp/setup", setup);
    renderPage(<TwoFactorCard enabled={false} onChange={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Set up" }));
    const key = (await screen.findByLabelText("Setup key")) as HTMLInputElement;
    const sel = vi.spyOn(key, "select");
    key.focus();
    expect(sel).toHaveBeenCalled();
  });

  it("a rejected code shows the error, keeps the dialog open, and clears it on edit", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    mockApi.post("/v1/admin/auth/totp/setup", setup);
    mockApi.post("/v1/admin/auth/totp/enable", fail(400, "Invalid code"));
    renderPage(<TwoFactorCard enabled={false} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Set up" }));
    const code = await screen.findByLabelText(/Code from the app/);
    await user.type(code, "000000");
    await user.click(within(dialog()).getByRole("button", { name: "Turn on" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid code");
    expect(onChange).not.toHaveBeenCalled();
    expect(dialog()).toBeTruthy();
    await user.type(code, "1");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("Cancel closes without enabling", async () => {
    const user = userEvent.setup();
    mockApi.post("/v1/admin/auth/totp/setup", setup);
    renderPage(<TwoFactorCard enabled={false} onChange={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Set up" }));
    await screen.findByLabelText("Setup key");
    await user.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Setup key")).toBeNull();
    expect(mockApi.callsTo("POST", "/v1/admin/auth/totp/enable")).toHaveLength(0);
  });

  it("toasts when setup cannot start", async () => {
    mockApi.post("/v1/admin/auth/totp/setup", fail(500, "no secret for you"));
    renderPage(<TwoFactorCard enabled={false} onChange={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Set up" }));
    expect(await screen.findByText("no secret for you")).toBeTruthy();
    expect(screen.queryByLabelText("Setup key")).toBeNull();
    expect(screen.getByRole("button", { name: "Set up" })).toBeEnabled();
  });

  it("non-Error failures fall back to generic message", async () => {
    mockApi.post("/v1/admin/auth/totp/setup", () => {
      throw "nope";  
    });
    renderPage(<TwoFactorCard enabled={false} onChange={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Set up" }));
    expect(await screen.findByText("Something went wrong")).toBeTruthy();
  });
});

describe("disabling", () => {
  it("needs the password and a 6+ char code, sends both, then reports off", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    mockApi.post("/v1/admin/auth/totp/disable", { ok: true });
    renderPage(<TwoFactorCard enabled onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Turn off" }));
    const d = dialog();
    const submit = within(d).getByRole("button", { name: "Turn off" });
    expect(submit).toBeDisabled();
    const pw = within(d).getByLabelText(/Password/);
    expect(document.activeElement).toBe(pw);
    await user.type(pw, "hunter2");
    expect(submit).toBeDisabled();
    await user.type(within(d).getByLabelText(/Code from the app/), " 123456 ");
    expect(submit).toBeEnabled();
    await user.click(submit);
    await screen.findByText("Two-factor authentication is off");
    expect(mockApi.callsTo("POST", "/v1/admin/auth/totp/disable")[0].body).toEqual({ password: "hunter2", code: "123456" });
    expect(onChange).toHaveBeenCalledWith(false);
    expect(dialog()).toBeNull();
  });

  it("shows the server's refusal and lets the operator retry; code edits clear the error", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    mockApi.post("/v1/admin/auth/totp/disable", fail(401, "Wrong password"));
    renderPage(<TwoFactorCard enabled onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Turn off" }));
    const d = dialog();
    await user.type(within(d).getByLabelText(/Password/), "x");
    const code = within(d).getByLabelText(/Code from the app/);
    await user.type(code, "123456");
    await user.click(within(d).getByRole("button", { name: "Turn off" }));
    expect(await within(d).findByRole("alert")).toHaveTextContent("Wrong password");
    expect(onChange).not.toHaveBeenCalled();
    expect(within(d).getByRole("button", { name: "Turn off" })).toBeEnabled();
    await user.type(code, "7");
    expect(within(d).queryByRole("alert")).toBeNull();
  });

  it("Cancel dismisses", async () => {
    const user = userEvent.setup();
    renderPage(<TwoFactorCard enabled onChange={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Turn off" }));
    await user.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(dialog()).toBeNull();
    expect(mockApi.callsTo("POST", "/v1/admin/auth/totp/disable")).toHaveLength(0);
  });
});

describe("sign out everywhere else", () => {
  it("stores the fresh token for this tab and confirms", async () => {
    const token = fakeJwt({ exp: Math.floor(Date.now() / 1000) + 3600, role: "owner" });
    mockApi.post("/v1/admin/auth/sign-out-all", { access_token: token, expires_in: 3600 });
    renderPage(<TwoFactorCard enabled={false} onChange={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Sign out others" }));
    expect(await screen.findByText("Signed out everywhere else")).toBeTruthy();
    expect(getToken()).toBe(token);
  });
  it("reports failure and keeps the existing token", async () => {
    window.localStorage.setItem("katha_admin_token", "old");
    mockApi.post("/v1/admin/auth/sign-out-all", fail(500, "cannot revoke"));
    renderPage(<TwoFactorCard enabled={false} onChange={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Sign out others" }));
    expect(await screen.findByText("cannot revoke")).toBeTruthy();
    expect(getToken()).toBe("old");
  });
});
