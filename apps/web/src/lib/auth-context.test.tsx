import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appWrapper } from "@/test-utils/app";
import type { ReactNode } from "react";

const GET = vi.fn();
const exchangeMock = vi.fn();
const logoutMock = vi.fn();
const track = vi.fn();
const getFirebaseAuth = vi.fn();
const getRedirectResult = vi.fn();
let isConfigured = true;

vi.mock("./client-api", () => ({ clientApi: { GET: (...a: unknown[]) => GET(...a) } }));
vi.mock("./auth-bff", () => ({
  authBff: { exchange: (...a: unknown[]) => exchangeMock(...a), logout: (...a: unknown[]) => logoutMock(...a) },
}));
vi.mock("./analytics", () => ({ track: (...a: unknown[]) => track(...a) }));
vi.mock("./firebase", () => ({
  isFirebaseConfigured: () => isConfigured,
  getFirebaseAuth: (...a: unknown[]) => getFirebaseAuth(...a),
}));
vi.mock("firebase/auth", () => ({ getRedirectResult: (...a: unknown[]) => getRedirectResult(...a) }));

import { AuthProvider, REDIRECT_FLAG, useAuth } from "./auth-context";
import { tokenStore } from "./token-store";

const ok = (data: unknown) => ({ data, response: { ok: true, status: 200 } });
const fail = (status: number) => ({ error: { detail: "x" }, response: { ok: false, status } });
const user = { id: "u1", coin_balance: 50 };

function wrapper(overrides = {}) {
  const App = appWrapper({ lang: "hi", ...overrides });
  return function AuthWrapper({ children }: { children: ReactNode }) {
    return (
      <App>
        <AuthProvider>{children}</AuthProvider>
      </App>
    );
  };
}

beforeEach(() => {
  GET.mockReset();
  exchangeMock.mockReset();
  logoutMock.mockReset().mockResolvedValue({ data: { ok: true }, response: { ok: true, status: 200 } });
  getFirebaseAuth.mockReset().mockResolvedValue(null);
  getRedirectResult.mockReset();
  isConfigured = true;
  tokenStore.clear();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("useAuth", () => {
  it("throws outside the provider", () => {
    expect(() => renderHook(() => useAuth(), { wrapper: appWrapper() })).toThrow("useAuth must be used inside AuthProvider");
  });
});

describe("AuthProvider initial load", () => {
  it("is anonymous with no stored token and never calls /me", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: wrapper() });
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("anonymous"));
    expect(GET).not.toHaveBeenCalled();
    expect(result.current.balance).toBe(0);
    expect(result.current.firebaseConfigured).toBe(true);
  });

  it("loads the profile when a token exists", async () => {
    tokenStore.set({ access_token: "t", expires_in: 900 });
    GET.mockResolvedValue(ok(user));
    const { result } = renderHook(() => useAuth(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.status).toBe("authenticated"));
    expect(result.current.user).toEqual(user);
    expect(result.current.balance).toBe(50);
    act(() => result.current.setBalance(7));
    expect(result.current.balance).toBe(7);
  });

  it.each([401, 403])("clears the token on %s", async (status) => {
    tokenStore.set({ access_token: "t", expires_in: 900 });
    GET.mockResolvedValue(fail(status));
    const { result } = renderHook(() => useAuth(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.status).toBe("anonymous"));
    expect(tokenStore.has()).toBe(false);
  });

  it("keeps the token on a transient failure but resolves out of loading", async () => {
    tokenStore.set({ access_token: "t", expires_in: 900 });
    GET.mockResolvedValue(fail(500));
    const { result } = renderHook(() => useAuth(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.status).toBe("anonymous"));
    expect(tokenStore.has()).toBe(true);
  });

  it("a transient failure on refresh keeps an authenticated status", async () => {
    tokenStore.set({ access_token: "t", expires_in: 900 });
    GET.mockResolvedValueOnce(ok(user));
    const { result } = renderHook(() => useAuth(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.status).toBe("authenticated"));
    GET.mockResolvedValueOnce(fail(500));
    await act(() => result.current.refreshUser());
    expect(result.current.status).toBe("authenticated");
  });

  it("ignores a stale load that resolves after a newer one", async () => {
    tokenStore.set({ access_token: "t", expires_in: 900 });
    let resolveFirst!: (v: unknown) => void;
    GET.mockReturnValueOnce(new Promise((r) => (resolveFirst = r)));
    const { result } = renderHook(() => useAuth(), { wrapper: wrapper() });
    GET.mockResolvedValueOnce(ok({ ...user, id: "new" }));
    await act(() => result.current.refreshUser());
    expect(result.current.user?.id).toBe("new");
    await act(async () => resolveFirst(ok({ ...user, id: "old" })));
    expect(result.current.user?.id).toBe("new");
  });
});

describe("dialog", () => {
  it("opens and closes", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.status).toBe("anonymous"));
    act(() => result.current.openAuth());
    expect(result.current.dialogOpen).toBe(true);
    act(() => result.current.closeAuth());
    expect(result.current.dialogOpen).toBe(false);
  });
});

describe("exchange", () => {
  it("returns the error and stores nothing when the BFF fails", async () => {
    exchangeMock.mockResolvedValue({ error: { detail: { code: "bad", message: "no" } }, response: { ok: false, status: 400 } });
    const { result } = renderHook(() => useAuth(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.status).toBe("anonymous"));
    let err: unknown;
    await act(async () => (err = await result.current.exchange("idtok")));
    expect(err).toEqual({ status: 400, code: "bad", message: "no" });
    expect(tokenStore.has()).toBe(false);
  });

  it("stores the grant, tracks signup + referral_signup, clears the referral, loads the user, closes the dialog", async () => {
    window.sessionStorage.setItem("katha.ref", "ABCD1234");
    exchangeMock.mockResolvedValue({ data: { access_token: "a", expires_in: 900, is_new_user: true }, response: { ok: true, status: 200 } });
    GET.mockResolvedValue(ok(user));
    const { result } = renderHook(() => useAuth(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.status).toBe("anonymous"));
    act(() => result.current.openAuth());
    let err: unknown = "unset";
    await act(async () => (err = await result.current.exchange("idtok", "google")));
    expect(err).toBeNull();
    expect(exchangeMock).toHaveBeenCalledWith(
      expect.objectContaining({ firebase_id_token: "idtok", locale: "hi", referral_code: "ABCD1234", app_version: "web-0.1.0", device_id: expect.any(String) }),
    );
    expect(tokenStore.current()).toBe("a");
    expect(window.sessionStorage.getItem("katha.ref")).toBeNull();
    expect(track).toHaveBeenCalledWith("signup", { method: "google" });
    expect(track).toHaveBeenCalledWith("referral_signup", { method: "google" });
    expect(result.current.status).toBe("authenticated");
    expect(result.current.dialogOpen).toBe(false);
  });

  it("tracks login (no referral_signup) for a returning user", async () => {
    exchangeMock.mockResolvedValue({ data: { access_token: "a", expires_in: 900, is_new_user: false }, response: { ok: true, status: 200 } });
    GET.mockResolvedValue(ok(user));
    const { result } = renderHook(() => useAuth(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.status).toBe("anonymous"));
    await act(async () => void (await result.current.exchange("idtok")));
    expect(track).toHaveBeenCalledWith("login", { method: "email" });
    expect(track).toHaveBeenCalledTimes(1);
  });
});

describe("signOut", () => {
  it("revokes via the BFF, clears local state and signs out of Firebase", async () => {
    tokenStore.set({ access_token: "t", expires_in: 900 });
    GET.mockResolvedValue(ok(user));
    const fbSignOut = vi.fn();
    getFirebaseAuth.mockResolvedValue({ currentUser: {}, signOut: fbSignOut });
    const { result } = renderHook(() => useAuth(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.status).toBe("authenticated"));
    await act(() => result.current.signOut());
    expect(logoutMock).toHaveBeenCalledWith("t");
    expect(tokenStore.has()).toBe(false);
    expect(result.current.status).toBe("anonymous");
    expect(result.current.user).toBeNull();
    expect(fbSignOut).toHaveBeenCalled();
  });

  it("still signs out locally when Firebase throws or has no current user", async () => {
    getFirebaseAuth.mockRejectedValueOnce(new Error("sdk"));
    const { result } = renderHook(() => useAuth(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.status).toBe("anonymous"));
    await act(() => result.current.signOut());
    expect(result.current.status).toBe("anonymous");
    const signOut = vi.fn();
    getFirebaseAuth.mockResolvedValue({ currentUser: null, signOut });
    await act(() => result.current.signOut());
    expect(signOut).not.toHaveBeenCalled();
  });
});

describe("cross-tab token changes", () => {
  it("signs this tab out when the token is cleared elsewhere", async () => {
    tokenStore.set({ access_token: "t", expires_in: 900 });
    GET.mockResolvedValue(ok(user));
    const { result } = renderHook(() => useAuth(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.status).toBe("authenticated"));
    act(() => tokenStore.clear());
    expect(result.current.status).toBe("anonymous");
    expect(result.current.user).toBeNull();
  });

  it("loads the profile when another tab signs in, but not for rotation or local writes", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.status).toBe("anonymous"));
    GET.mockResolvedValue(ok(user));
    act(() => tokenStore.set({ access_token: "local", expires_in: 900 }));
    expect(GET).not.toHaveBeenCalled();
    window.localStorage.setItem("katha.tokens", JSON.stringify({ access_token: "other", expires_at: Date.now() + 1e6 }));
    await act(async () => void window.dispatchEvent(new StorageEvent("storage", { key: "katha.tokens" })));
    await waitFor(() => expect(result.current.status).toBe("authenticated"));
    GET.mockClear();
    await act(async () => void window.dispatchEvent(new StorageEvent("storage", { key: "katha.tokens" })));
    expect(GET).not.toHaveBeenCalled();
  });
});

describe("redirect sign-in completion", () => {
  const grant = (is_new_user: boolean) => ({ data: { access_token: "r", expires_in: 900, is_new_user }, response: { ok: true, status: 200 } });

  it("does nothing without the redirect flag", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.status).toBe("anonymous"));
    expect(getFirebaseAuth).not.toHaveBeenCalled();
  });

  it("exchanges the redirect result, tracks and loads the user", async () => {
    window.sessionStorage.setItem(REDIRECT_FLAG, "1");
    window.sessionStorage.setItem("katha.ref", "ABCD1234");
    getFirebaseAuth.mockResolvedValue({});
    getRedirectResult.mockResolvedValue({ user: { getIdToken: async () => "fb-token" } });
    exchangeMock.mockResolvedValue(grant(true));
    GET.mockResolvedValue(ok(user));
    const { result } = renderHook(() => useAuth(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.status).toBe("authenticated"));
    expect(window.sessionStorage.getItem(REDIRECT_FLAG)).toBeNull();
    expect(exchangeMock).toHaveBeenCalledWith(expect.objectContaining({ firebase_id_token: "fb-token", referral_code: "ABCD1234", locale: "hi" }));
    expect(track).toHaveBeenCalledWith("signup", { method: "google", via: "redirect" });
    expect(track).toHaveBeenCalledWith("referral_signup", { method: "google" });
  });

  it("tracks login without a referral", async () => {
    window.sessionStorage.setItem(REDIRECT_FLAG, "1");
    getFirebaseAuth.mockResolvedValue({});
    getRedirectResult.mockResolvedValue({ user: { getIdToken: async () => "t" } });
    exchangeMock.mockResolvedValue(grant(false));
    GET.mockResolvedValue(ok(user));
    renderHook(() => useAuth(), { wrapper: wrapper() });
    await waitFor(() => expect(track).toHaveBeenCalledWith("login", { method: "google", via: "redirect" }));
    expect(track).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["no firebase auth", () => getFirebaseAuth.mockResolvedValue(null)],
    ["no redirect result", () => (getFirebaseAuth.mockResolvedValue({}), getRedirectResult.mockResolvedValue(null))],
    ["exchange failure", () => {
      getFirebaseAuth.mockResolvedValue({});
      getRedirectResult.mockResolvedValue({ user: { getIdToken: async () => "t" } });
      exchangeMock.mockResolvedValue({ error: { detail: "x" }, response: { ok: false, status: 400 } });
    }],
    ["sdk error", () => (getFirebaseAuth.mockResolvedValue({}), getRedirectResult.mockRejectedValue(new Error("x")))],
  ])("stays anonymous on %s", async (_n, arrange) => {
    window.sessionStorage.setItem(REDIRECT_FLAG, "1");
    arrange();
    const { result } = renderHook(() => useAuth(), { wrapper: wrapper() });
    await waitFor(() => expect(getFirebaseAuth).toHaveBeenCalled());
    await waitFor(() => expect(result.current.status).toBe("anonymous"));
    expect(tokenStore.has()).toBe(false);
    expect(track).not.toHaveBeenCalled();
  });
});

describe("device description", () => {
  const uas: [string, string][] = [
    ["Mozilla/5.0 (Linux; Android 14) Chrome/120", "Chrome on Android"],
    ["Mozilla/5.0 (iPhone) Safari/604", "Safari on iOS"],
    ["Mozilla/5.0 (Windows NT 10) Edg/120 Chrome/120", "Edge on Windows"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X) OPR/100 Chrome/120", "Opera on macOS"],
    ["Mozilla/5.0 (X11; Linux) Firefox/120", "Firefox on Linux"],
    ["weird", "Browser on Web"],
  ];
  it.each(uas)("%s", async (ua, expected) => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ua);
    exchangeMock.mockResolvedValue({ data: { access_token: "a", expires_in: 900, is_new_user: false }, response: { ok: true, status: 200 } });
    GET.mockResolvedValue(ok(user));
    const { result } = renderHook(() => useAuth(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.status).toBe("anonymous"));
    await act(async () => void (await result.current.exchange("t")));
    expect(exchangeMock.mock.calls[0][0].device_name).toBe(expected);
  });
});
