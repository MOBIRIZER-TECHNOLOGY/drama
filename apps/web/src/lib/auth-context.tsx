"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { track } from "./analytics";
import { clientApi } from "./client-api";
import { call, type ApiError } from "./errors";
import { clearReferral, pendingReferral } from "./referral";
import { isFirebaseConfigured, getFirebaseAuth } from "./firebase";
import { tokenStore } from "./token-store";
import { useLoader } from "./use-loader";
import type { UserOut } from "./types";
import { useApp } from "./app-context";

export type AuthStatus = "loading" | "anonymous" | "authenticated";

export type AuthContextValue = {
  status: AuthStatus;
  user: UserOut | null;
  balance: number;
  firebaseConfigured: boolean;
  dialogOpen: boolean;
  openAuth: () => void;
  closeAuth: () => void;
  /** Trade a Firebase ID token for Katha tokens and load the profile. */
  exchange: (firebaseIdToken: string, method?: string) => Promise<ApiError | null>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
  setBalance: (balance: number) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/** Set before `signInWithRedirect` so the next page load knows to call `getRedirectResult`. */
export const REDIRECT_FLAG = "katha.auth_redirect";

export function AuthProvider({ children }: { children: ReactNode }) {
  const { lang, config } = useApp();
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<UserOut | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const remoteFirebase = config?.firebase ?? null;
  const firebaseConfigured = isFirebaseConfigured(remoteFirebase);
  const loadSeq = useRef(0);

  const loadUser = useCallback(async () => {
    const seq = ++loadSeq.current;
    const result = await (tokenStore.has() ? call(() => clientApi.GET("/v1/auth/me")) : Promise.resolve(null));
    if (seq !== loadSeq.current) return;
    if (!result) {
      setUser(null);
      setStatus("anonymous");
      return;
    }
    const { data, error } = result;
    if (data) {
      setUser(data);
      setStatus("authenticated");
    } else if (error.status === 401 || error.status === 403) {
      tokenStore.clear();
      setUser(null);
      setStatus("anonymous");
    } else {
      // Transient failure: keep the tokens and whatever status we already had; only the very first load resolves
      // to anonymous so the header does not stay in its loading state.
      setStatus((s) => (s === "loading" ? "anonymous" : s));
    }
  }, []);

  useLoader(loadUser);

  // A Google sign-in that fell back to signInWithRedirect (popup blocked) lands back here: finish the exchange.
  const finishRedirect = useCallback(async () => {
    if (typeof window === "undefined" || window.sessionStorage.getItem(REDIRECT_FLAG) !== "1") return;
    window.sessionStorage.removeItem(REDIRECT_FLAG);
    try {
      const auth = await getFirebaseAuth(remoteFirebase);
      if (!auth) return;
      const { getRedirectResult } = await import("firebase/auth");
      const result = await getRedirectResult(auth);
      if (!result) return;
      const idToken = await result.user.getIdToken();
      const referral = pendingReferral();
      const { data } = await call(() =>
        clientApi.POST("/v1/auth/exchange", {
          body: {
            firebase_id_token: idToken,
            platform: "web",
            device_id: tokenStore.deviceId(),
            device_name: describeDevice(navigator.userAgent),
            app_version: "web-0.1.0",
            locale: lang,
            referral_code: referral,
          },
        }),
      );
      if (data) {
        tokenStore.set(data);
        clearReferral();
        track(data.is_new_user ? "signup" : "login", { method: "google", via: "redirect" });
        if (data.is_new_user && referral) track("referral_signup", { method: "google" });
        await loadUser();
      }
    } catch {
      /* the dialog offers the popup again */
    }
  }, [remoteFirebase, lang, loadUser]);

  useLoader(finishRedirect);

  useEffect(
    () =>
      tokenStore.subscribe((tokens) => {
        if (!tokens) {
          setUser(null);
          setStatus("anonymous");
        }
      }),
    [],
  );

  const exchange = useCallback(
    async (firebaseIdToken: string, method = "email"): Promise<ApiError | null> => {
      const referral = pendingReferral();
      const { data, error } = await call(() =>
        clientApi.POST("/v1/auth/exchange", {
          body: {
            firebase_id_token: firebaseIdToken,
            platform: "web",
            device_id: tokenStore.deviceId(),
            device_name: typeof navigator !== "undefined" ? describeDevice(navigator.userAgent) : "Web",
            app_version: "web-0.1.0",
            locale: lang,
            referral_code: referral,
          },
        }),
      );
      if (error) return error;
      tokenStore.set(data);
      clearReferral();
      track(data.is_new_user ? "signup" : "login", { method });
      if (data.is_new_user && referral) track("referral_signup", { method });
      await loadUser();
      setDialogOpen(false);
      return null;
    },
    [lang, loadUser],
  );

  const signOut = useCallback(async () => {
    if (tokenStore.has()) await call(() => clientApi.POST("/v1/auth/logout"));
    tokenStore.clear();
    setUser(null);
    setStatus("anonymous");
    try {
      const auth = await getFirebaseAuth(remoteFirebase);
      if (auth?.currentUser) await auth.signOut();
    } catch {
      /* Firebase session is best-effort */
    }
  }, [remoteFirebase]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      balance: user?.coin_balance ?? 0,
      firebaseConfigured,
      dialogOpen,
      openAuth: () => setDialogOpen(true),
      closeAuth: () => setDialogOpen(false),
      exchange,
      signOut,
      refreshUser: loadUser,
      setBalance: (balance) => setUser((u) => (u ? { ...u, coin_balance: balance } : u)),
    }),
    [status, user, firebaseConfigured, dialogOpen, exchange, signOut, loadUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

function describeDevice(ua: string): string {
  const os = /Android/i.test(ua)
    ? "Android"
    : /iPhone|iPad/i.test(ua)
      ? "iOS"
      : /Windows/i.test(ua)
        ? "Windows"
        : /Mac OS/i.test(ua)
          ? "macOS"
          : /Linux/i.test(ua)
            ? "Linux"
            : "Web";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : /Firefox\//.test(ua)
            ? "Firefox"
            : "Browser";
  return `${browser} on ${os}`;
}
