"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, call, type Schemas } from "./api";
import { clearToken, getToken, setToken } from "./token";

export type Admin = Schemas["AdminOut"];

type AuthState = {
  admin: Admin | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<Admin>;
  logout: () => void;
  reload: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    call(api.GET("/v1/admin/auth/me")).then(
      (me) => {
        if (cancelled) return;
        setAdmin(me);
        setStatus("ready");
      },
      (e: Error) => {
        if (cancelled) return;
        setError(e.message);
        setStatus("error");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [router, tick]);

  const login = useCallback(async (email: string, password: string) => {
    const token = await call(api.POST("/v1/admin/auth/login", { body: { email, password } }));
    setToken(token.access_token, token.expires_in);
    const me = await call(api.GET("/v1/admin/auth/me"));
    setAdmin(me);
    setStatus("ready");
    return me;
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setAdmin(null);
    router.replace("/login");
  }, [router]);

  const value = useMemo<AuthState>(
    () => ({
      admin,
      loading: status === "idle" || status === "loading",
      error,
      login,
      logout,
      reload: () => setTick((t) => t + 1),
    }),
    [admin, status, error, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

/** Current admin; only valid inside the authenticated shell. */
export function useAdmin(): Admin {
  const { admin } = useAuth();
  if (!admin) throw new Error("useAdmin called outside an authenticated area");
  return admin;
}
