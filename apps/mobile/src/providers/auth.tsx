import { useRouter, type Href } from "expo-router";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  OAuthProvider,
  signInWithCredential,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
  type User as FirebaseUser,
} from "firebase/auth";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import { track } from "@/lib/analytics";
import { api, platform, tokens } from "@/lib/api";
import { getAppVersion, getDeviceId, getDeviceName } from "@/lib/device";
import { RequestError, unwrap } from "@/lib/errors";
import { getFirebaseAuth } from "@/lib/firebase";
import type { UserOut } from "@/lib/types";
import { useConfig } from "@/providers/config";

export type AuthStatus = "loading" | "guest" | "signed_in";

type AuthContextValue = {
  status: AuthStatus;
  user: UserOut | null;
  balance: number;
  setBalance: (n: number) => void;
  refreshUser: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string, displayName?: string) => Promise<void>;
  signInWithGoogleIdToken: (idToken: string) => Promise<void>;
  signInWithApple: (identityToken: string, rawNonce: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Replace the cached profile (e.g. after PATCH /v1/auth/me). */
  applyUser: (user: UserOut | null) => void;
  /**
   * Guests may browse; call this from gated actions. Returns true when already signed in, otherwise opens the
   * auth modal. Pass `returnTo` only when the caller needs the app to land somewhere specific after sign-in
   * (e.g. the player at a given episode); by default the modal simply closes back to where the user was.
   */
  requireAuth: (returnTo?: Href) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const router = useRouter();
  const { lang, ready } = useConfig();
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<UserOut | null>(null);
  const [balance, setBalanceState] = useState(0);
  const langRef = useRef(lang);
  useEffect(() => {
    langRef.current = lang;
  }, [lang]);

  const applyUser = useCallback((u: UserOut | null) => {
    setUser(u);
    setBalanceState(u?.coin_balance ?? 0);
    setStatus(u ? "signed_in" : "guest");
  }, []);

  /**
   * Session restore. Only the refresh endpoint may end a session (it fires `onSignedOut`); a 401 from /me after
   * a failed refresh, a timeout or a network error keeps the stored tokens and shows the last known state.
   */
  const refreshUser = useCallback(async () => {
    if (!tokens.hasSession()) {
      applyUser(null);
      return;
    }
    try {
      const { data } = await api.GET("/v1/auth/me");
      if (data) {
        applyUser(data);
        return;
      }
    } catch {
      // fall through to the conservative status below
    }
    setStatus(tokens.hasSession() ? "signed_in" : "guest");
  }, [applyUser]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      await tokens.load();
      if (cancelled) return;
      await refreshUser();
    })();
    const off = tokens.onSignedOut(() => applyUser(null));
    return () => {
      cancelled = true;
      off();
    };
  }, [ready, refreshUser, applyUser]);

  /** Trade the Firebase user for Katha tokens, then drop the Firebase session: it has done its job. */
  const exchange = useCallback(
    async (fb: FirebaseUser, method: "email" | "google" | "apple") => {
      let isNewUser = false;
      try {
        const idToken = await fb.getIdToken();
        const pair = unwrap(
          await api.POST("/v1/auth/exchange", {
            body: {
              firebase_id_token: idToken,
              platform,
              device_id: await getDeviceId(),
              device_name: getDeviceName(),
              app_version: getAppVersion(),
              locale: langRef.current,
            },
          }),
        );
        isNewUser = pair.is_new_user === true;
        await tokens.set(pair);
      } finally {
        firebaseSignOut(getFirebaseAuth()).catch(() => {});
      }
      const me = unwrap(await api.GET("/v1/auth/me"));
      applyUser(me);
      // `is_new_user` comes from the exchange, so a first Google/Apple sign-in is reported as a signup.
      track(isNewUser ? "signup" : "login", { method });
    },
    [applyUser],
  );

  const signInWithEmail = useCallback(
    async (email: string, password: string) => {
      const cred = await signInWithEmailAndPassword(getFirebaseAuth(), email.trim(), password);
      await exchange(cred.user, "email");
    },
    [exchange],
  );

  const signUpWithEmail = useCallback(
    async (email: string, password: string, displayName?: string) => {
      const cred = await createUserWithEmailAndPassword(getFirebaseAuth(), email.trim(), password);
      if (displayName?.trim()) {
        try {
          await updateProfile(cred.user, { displayName: displayName.trim() });
        } catch {
          // Display name is cosmetic; do not block sign-up on it.
        }
      }
      await exchange(cred.user, "email");
    },
    [exchange],
  );

  const signInWithGoogleIdToken = useCallback(
    async (idToken: string) => {
      const cred = await signInWithCredential(getFirebaseAuth(), GoogleAuthProvider.credential(idToken));
      await exchange(cred.user, "google");
    },
    [exchange],
  );

  const signInWithApple = useCallback(
    async (identityToken: string, rawNonce: string) => {
      const credential = new OAuthProvider("apple.com").credential({ idToken: identityToken, rawNonce });
      const cred = await signInWithCredential(getFirebaseAuth(), credential);
      await exchange(cred.user, "apple");
    },
    [exchange],
  );

  const signOut = useCallback(async () => {
    try {
      if (tokens.hasSession()) await api.POST("/v1/auth/logout");
    } catch {
      // Server-side revocation is best effort; local sign-out always proceeds.
    }
    await tokens.clear();
    applyUser(null);
  }, [applyUser]);

  const requireAuth = useCallback(
    (returnTo?: Href) => {
      if (status === "signed_in") return true;
      const target = typeof returnTo === "string" ? returnTo : undefined;
      router.push({ pathname: "/auth", params: target ? { returnTo: target } : {} });
      return false;
    },
    [router, status],
  );

  const setBalance = useCallback((n: number) => {
    setBalanceState(n);
    setUser((u) => (u ? { ...u, coin_balance: n } : u));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      balance,
      setBalance,
      refreshUser,
      signInWithEmail,
      signUpWithEmail,
      signInWithGoogleIdToken,
      signInWithApple,
      signOut,
      applyUser,
      requireAuth,
    }),
    [status, user, balance, setBalance, refreshUser, signInWithEmail, signUpWithEmail, signInWithGoogleIdToken, signInWithApple, signOut, applyUser, requireAuth],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

/** Map Firebase auth error codes to short human messages. */
export function firebaseErrorMessage(error: unknown): string {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
  switch (code) {
    case "auth/invalid-email":
      return "That email address looks wrong";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Email or password is incorrect";
    case "auth/email-already-in-use":
      return "An account with this email already exists";
    case "auth/weak-password":
      return "Use at least 6 characters for your password";
    case "auth/too-many-requests":
      return "Too many attempts. Try again in a bit";
    case "auth/network-request-failed":
      return "Network error. Check your connection";
    default:
      if (error instanceof RequestError) return error.message;
      if (error instanceof Error && error.message) return error.message;
      return "Could not sign in";
  }
}
