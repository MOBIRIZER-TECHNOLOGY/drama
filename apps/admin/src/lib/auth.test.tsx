import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { fail, mockApi } from "@/test/api";
import { nav } from "@/test/navigation";
import { AuthProvider, useAdmin, useAuth } from "./auth";
import { TOKEN_KEY, setToken } from "./token";

const me = { id: "a1", email: "o@x.co", role: "owner" };
const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>;

describe("AuthProvider", () => {
  it("redirects to /login without a token and never calls the API", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(nav.router.replace).toEqual(["/login"]);
    expect(mockApi.calls).toHaveLength(0);
    expect(result.current.admin).toBeNull();
    expect(result.current.loading).toBe(true);
  });

  it("loads the admin when a token exists", async () => {
    setToken("tok", 60);
    mockApi.get("/v1/admin/auth/me", me);
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.admin).toEqual(me);
    expect(result.current.error).toBeNull();
  });

  it("exposes a load failure and retries via reload", async () => {
    setToken("tok", 60);
    mockApi.get("/v1/admin/auth/me", fail(500, "db down"));
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.error).toBe("db down"));
    expect(result.current.loading).toBe(false);
    expect(result.current.admin).toBeNull();
    mockApi.get("/v1/admin/auth/me", me);
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.admin).toEqual(me));
    expect(mockApi.callsTo("GET", "/v1/admin/auth/me")).toHaveLength(2);
  });

  it("ignores a response that arrives after unmount", async () => {
    setToken("tok", 60);
    let release!: () => void;
    mockApi.get("/v1/admin/auth/me", () => new Promise((r) => (release = () => r(me))));
    const { unmount } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(release).toBeTypeOf("function"));
    unmount();
    release();
    await Promise.resolve();
    // and the failure path
    mockApi.get("/v1/admin/auth/me", () => new Promise((_, r) => (release = () => r(new Error("x")))));
    const second = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(mockApi.callsTo("GET", "/v1/admin/auth/me")).toHaveLength(2));
    second.unmount();
    release();
  });

  it("login stores the token and the admin; logout clears them and goes to /login", async () => {
    mockApi.post("/v1/admin/auth/login", { access_token: "newtok", expires_in: 100 });
    mockApi.get("/v1/admin/auth/me", me);
    const { result } = renderHook(() => useAuth(), { wrapper });
    let returned;
    await act(async () => {
      returned = await result.current.login("o@x.co", "pw");
    });
    expect(returned).toEqual(me);
    expect(mockApi.callsTo("POST", "/v1/admin/auth/login")[0].body).toEqual({ email: "o@x.co", password: "pw" });
    expect(window.localStorage.getItem(TOKEN_KEY)).toBe("newtok");
    expect(mockApi.callsTo("GET", "/v1/admin/auth/me")[0].headers.get("authorization")).toBe("Bearer newtok");
    expect(result.current.admin).toEqual(me);
    expect(result.current.loading).toBe(false);

    act(() => result.current.logout());
    expect(result.current.admin).toBeNull();
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(nav.router.replace).toContain("/login");
  });
});

describe("hooks outside the provider", () => {
  it("useAuth throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useAuth())).toThrow("useAuth must be used inside AuthProvider");
  });
  it("useAdmin throws until an admin is loaded and returns it after", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setToken("tok", 60);
    mockApi.get("/v1/admin/auth/me", me);
    function Who() {
      const admin = useAdmin();
      return <p>{admin.email}</p>;
    }
    expect(() => render(<AuthProvider><Who /></AuthProvider>)).toThrow("useAdmin called outside an authenticated area");
    // After loading, a gated child renders.
    function Gate() {
      const { admin } = useAuth();
      return admin ? <Who /> : <p>loading</p>;
    }
    render(<AuthProvider><Gate /></AuthProvider>);
    expect(await screen.findByText("o@x.co")).toBeTruthy();
  });
});
