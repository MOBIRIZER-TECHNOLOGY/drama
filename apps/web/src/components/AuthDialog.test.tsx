import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appWrapper } from "@/test-utils/app";
import { auth, setAuth } from "@/test-utils/auth-context";

vi.mock("@/lib/auth-context", () => import("@/test-utils/auth-context"));

const getFirebaseAuth = vi.fn();
vi.mock("@/lib/firebase", async (orig) => ({
  ...(await orig<typeof import("@/lib/firebase")>()),
  getFirebaseAuth: (...a: unknown[]) => getFirebaseAuth(...a),
}));

const fb = {
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  signInWithPopup: vi.fn(),
  signInWithRedirect: vi.fn(),
  signInWithPhoneNumber: vi.fn(),
  setCustomParameters: vi.fn(),
  recaptchaClear: vi.fn(),
};
vi.mock("firebase/auth", () => ({
  signInWithEmailAndPassword: (...a: unknown[]) => fb.signInWithEmailAndPassword(...a),
  createUserWithEmailAndPassword: (...a: unknown[]) => fb.createUserWithEmailAndPassword(...a),
  sendPasswordResetEmail: (...a: unknown[]) => fb.sendPasswordResetEmail(...a),
  signInWithPopup: (...a: unknown[]) => fb.signInWithPopup(...a),
  signInWithRedirect: (...a: unknown[]) => fb.signInWithRedirect(...a),
  signInWithPhoneNumber: (...a: unknown[]) => fb.signInWithPhoneNumber(...a),
  GoogleAuthProvider: class {
    setCustomParameters = (...a: unknown[]) => fb.setCustomParameters(...a);
  },
  RecaptchaVerifier: class {
    clear = () => fb.recaptchaClear();
  },
}));

import { AuthDialog, FirebaseMissing } from "./AuthDialog";

const FB_AUTH = { fake: "auth" };
const cred = { user: { getIdToken: async () => "id-token" } };

function open(config: object | null = null, authPatch = {}) {
  setAuth({ dialogOpen: true, ...authPatch });
  return render(<AuthDialog />, { wrapper: appWrapper({ config: config as never }) });
}
const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submit = (el: HTMLElement) => fireEvent.submit(el.closest("form")!);

beforeEach(() => {
  getFirebaseAuth.mockReset().mockResolvedValue(FB_AUTH);
  for (const f of Object.values(fb)) f.mockReset();
  fb.signInWithEmailAndPassword.mockResolvedValue(cred);
  fb.createUserWithEmailAndPassword.mockResolvedValue(cred);
  fb.signInWithPopup.mockResolvedValue(cred);
  setAuth();
});

describe("AuthDialog shell", () => {
  it("renders nothing inside when closed", () => {
    setAuth({ dialogOpen: false });
    render(<AuthDialog />, { wrapper: appWrapper() });
    expect(screen.queryByText("Continue with Google")).toBeNull();
  });

  it("shows the missing-config notice when Firebase isn't configured", () => {
    open(null, { firebaseConfigured: false });
    expect(screen.getByText("Sign-in is not available right now.")).toBeTruthy();
    expect(screen.getByText(/keep browsing/)).toBeTruthy();
  });

  it("closing the dialog calls closeAuth", () => {
    open();
    fireEvent.click(screen.getByLabelText("Close"));
    expect(auth.closeAuth).toHaveBeenCalled();
  });

  it("FirebaseMissing names env vars only in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    const dev = render(<FirebaseMissing />, { wrapper: appWrapper() });
    expect(dev.container.textContent).toContain("NEXT_PUBLIC_FIREBASE_*");
    dev.unmount();
    vi.stubEnv("NODE_ENV", "production");
    const prod = render(<FirebaseMissing />, { wrapper: appWrapper() });
    expect(prod.container.textContent).not.toContain("NEXT_PUBLIC_FIREBASE");
    vi.unstubAllEnvs();
  });
});

describe("method availability", () => {
  it("leads with phone, offers the bonus pitch and both tabs", () => {
    open({ rewards: { signup_bonus: 50 } });
    expect(screen.getByText(/add 50 coins/)).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Phone" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByLabelText("Phone number")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Email" }));
    expect(screen.getByLabelText("Email", { selector: "input" })).toBeTruthy();
  });

  it("defaults to email when phone is disabled and hides tabs and the divider appropriately", () => {
    open({ auth: { phone: false } });
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.getByText("or")).toBeTruthy();
  });

  it("hides Google and the divider when disabled", () => {
    open({ auth: { google: false } });
    expect(screen.queryByText("Continue with Google")).toBeNull();
    expect(screen.queryByText("or")).toBeNull();
  });
});

describe("email sign-in / sign-up", () => {
  const emailTab = () => fireEvent.click(screen.getByRole("tab", { name: "Email" }));

  it("signs in, trimming the email, and exchanges the ID token", async () => {
    open();
    emailTab();
    type("Email", "  a@b.co ");
    type("Password", "secret1");
    submit(screen.getByLabelText("Password"));
    await waitFor(() => expect(auth.exchange).toHaveBeenCalledWith("id-token", "email"));
    expect(fb.signInWithEmailAndPassword).toHaveBeenCalledWith(FB_AUTH, "a@b.co", "secret1");
  });

  it("switches to sign-up mode (heading changes) and creates the account", async () => {
    open();
    emailTab();
    fireEvent.click(screen.getByText("Create an account"));
    expect(screen.getByRole("heading", { name: "Create an account" })).toBeTruthy();
    expect(screen.queryByText("Forgot your password?")).toBeNull();
    type("Email", "a@b.co");
    type("Password", "secret1");
    submit(screen.getByLabelText("Password"));
    await waitFor(() => expect(fb.createUserWithEmailAndPassword).toHaveBeenCalledWith(FB_AUTH, "a@b.co", "secret1"));
    await waitFor(() => expect(auth.exchange).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Sign in", hidden: true }) as HTMLElement);
    expect(screen.queryByRole("heading", { name: "Create an account" })).toBeNull();
  });

  it("surfaces Firebase errors in the viewer's language", async () => {
    fb.signInWithEmailAndPassword.mockRejectedValue({ code: "auth/wrong-password" });
    open();
    emailTab();
    type("Email", "a@b.co");
    type("Password", "secret1");
    submit(screen.getByLabelText("Password"));
    expect((await screen.findByRole("alert")).textContent).toBe("Email or password is incorrect.");
    expect(auth.exchange).not.toHaveBeenCalled();
  });

  it("shows the API's message when the exchange fails", async () => {
    open();
    (auth.exchange as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 400, code: "x", message: "Account suspended" });
    emailTab();
    type("Email", "a@b.co");
    type("Password", "secret1");
    submit(screen.getByLabelText("Password"));
    expect((await screen.findByRole("alert")).textContent).toBe("Account suspended");
  });

  it("reports unavailable sign-in when Firebase can't be initialised", async () => {
    getFirebaseAuth.mockResolvedValue(null);
    open();
    emailTab();
    type("Email", "a@b.co");
    type("Password", "secret1");
    submit(screen.getByLabelText("Password"));
    expect((await screen.findByRole("alert")).textContent).toBe("Sign-in is not available right now.");
  });

  it("password reset needs an email, then confirms without revealing whether the account exists", async () => {
    open();
    emailTab();
    fireEvent.click(screen.getByText("Forgot your password?"));
    expect((await screen.findByRole("alert")).textContent).toBe("Enter your email address first.");
    type("Email", "a@b.co");
    fireEvent.click(screen.getByText("Forgot your password?"));
    await waitFor(() => expect(fb.sendPasswordResetEmail).toHaveBeenCalledWith(FB_AUTH, "a@b.co"));
    expect((await screen.findByRole("status")).textContent).toContain("If that address has an account");
  });

  it("reset with Firebase unavailable shows the unavailable error", async () => {
    getFirebaseAuth.mockResolvedValue(null);
    open();
    emailTab();
    fireEvent.click(screen.getByText("Forgot your password?"));
    expect((await screen.findByRole("alert")).textContent).toBe("Sign-in is not available right now.");
  });

  it("switching tabs clears the error", async () => {
    getFirebaseAuth.mockResolvedValue(null);
    open();
    emailTab();
    fireEvent.click(screen.getByText("Forgot your password?"));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("tab", { name: "Phone" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Google", () => {
  it("signs in with the popup and forces the account chooser", async () => {
    open();
    fireEvent.click(screen.getByText("Continue with Google"));
    await waitFor(() => expect(auth.exchange).toHaveBeenCalledWith("id-token", "google"));
    expect(fb.setCustomParameters).toHaveBeenCalledWith({ prompt: "select_account" });
  });

  it("falls back to redirect when the popup is blocked, flagging the return trip", async () => {
    fb.signInWithPopup.mockRejectedValue({ code: "auth/popup-blocked" });
    open();
    fireEvent.click(screen.getByText("Continue with Google"));
    await waitFor(() => expect(fb.signInWithRedirect).toHaveBeenCalled());
    expect(window.sessionStorage.getItem("katha.auth_redirect")).toBe("1");
    expect(auth.exchange).not.toHaveBeenCalled();
  });

  it("shows other popup errors", async () => {
    fb.signInWithPopup.mockRejectedValue({ code: "auth/popup-closed-by-user" });
    open();
    fireEvent.click(screen.getByText("Continue with Google"));
    expect((await screen.findByRole("alert")).textContent).toContain("sign-in window was closed");
    expect(fb.signInWithRedirect).not.toHaveBeenCalled();
  });

  it("unavailable when Firebase is null", async () => {
    getFirebaseAuth.mockResolvedValue(null);
    open();
    fireEvent.click(screen.getByText("Continue with Google"));
    expect((await screen.findByRole("alert")).textContent).toBe("Sign-in is not available right now.");
  });

  it("disables every method while one is in flight", async () => {
    let release!: (v: unknown) => void;
    fb.signInWithPopup.mockReturnValue(new Promise((r) => (release = r)));
    open();
    fireEvent.click(screen.getByText("Continue with Google"));
    await waitFor(() => expect((screen.getByText("Send code").closest("button") as HTMLButtonElement).disabled).toBe(true));
    await act(async () => release(cred));
  });
});

describe("phone", () => {
  const confirmation = { confirm: vi.fn() };

  it("sends a code to the number stripped of spaces, then verifies it", async () => {
    confirmation.confirm.mockReset().mockResolvedValue(cred);
    fb.signInWithPhoneNumber.mockResolvedValue(confirmation);
    open();
    type("Phone number", "+91 98765 43210");
    submit(screen.getByLabelText("Phone number"));
    await screen.findByLabelText("Verification code");
    expect(fb.signInWithPhoneNumber).toHaveBeenCalledWith(FB_AUTH, "+919876543210", expect.anything());
    expect((screen.getByLabelText("Phone number") as HTMLInputElement).disabled).toBe(true);
    type("Verification code", " 123456 ");
    submit(screen.getByLabelText("Verification code"));
    await waitFor(() => expect(auth.exchange).toHaveBeenCalledWith("id-token", "phone"));
    expect(confirmation.confirm).toHaveBeenCalledWith("123456");
  });

  it("lets the viewer change the number, clearing the reCAPTCHA", async () => {
    fb.signInWithPhoneNumber.mockResolvedValue(confirmation);
    open();
    type("Phone number", "+911234567890");
    submit(screen.getByLabelText("Phone number"));
    await screen.findByLabelText("Verification code");
    fireEvent.click(screen.getByText("Use a different number"));
    expect(screen.queryByLabelText("Verification code")).toBeNull();
    expect(fb.recaptchaClear).toHaveBeenCalled();
    expect((screen.getByLabelText("Phone number") as HTMLInputElement).disabled).toBe(false);
  });

  it("shows an error for a wrong code", async () => {
    confirmation.confirm.mockReset().mockRejectedValue({ code: "auth/invalid-verification-code" });
    fb.signInWithPhoneNumber.mockResolvedValue(confirmation);
    open();
    type("Phone number", "+911234567890");
    submit(screen.getByLabelText("Phone number"));
    await screen.findByLabelText("Verification code");
    type("Verification code", "000000");
    submit(screen.getByLabelText("Verification code"));
    expect((await screen.findByRole("alert")).textContent).toBe("That code is not correct.");
  });

  it("reuses one reCAPTCHA verifier across retries and clears it on close", async () => {
    fb.signInWithPhoneNumber.mockRejectedValueOnce({ code: "auth/invalid-phone-number" }).mockResolvedValue(confirmation);
    const { unmount } = open();
    type("Phone number", "123");
    submit(screen.getByLabelText("Phone number"));
    await screen.findByRole("alert");
    submit(screen.getByLabelText("Phone number"));
    await screen.findByLabelText("Verification code");
    unmount();
    expect(fb.recaptchaClear).toHaveBeenCalledTimes(1);
  });

  it("unavailable when Firebase is null", async () => {
    getFirebaseAuth.mockResolvedValue(null);
    open();
    type("Phone number", "+911234567890");
    submit(screen.getByLabelText("Phone number"));
    expect((await screen.findByRole("alert")).textContent).toBe("Sign-in is not available right now.");
  });
});
