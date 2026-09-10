import { useRouter, type Href } from "expo-router";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  OAuthProvider,
  signInWithCredential,
  sendPasswordResetEmail,
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
import { unregister as unregisterPush } from "@/lib/push";
import { getJson, setJson } from "@/lib/storage";
import type { UserOut } from "@/lib/types";
import { useConfig } from "@/providers/config";

/**
 * `stale` is a session with tokens but no profile: `/me` failed on restore and nothing was cached from an
 * earlier run. It is neither a guest (the tokens are still good as far as we know) nor signed in (there is no
 * user to show), and it resolves to one or the other on the next successful refresh.
 */
export type AuthStatus = "loading" | "guest" | "signed_in" | "stale";

type AuthContextValue = {
  status: AuthStatus;
  /** Non-null whenever `status` is `signed_in`. */
  user: UserOut | null;
  balance: number;
  setBalance: (n: number) => void;
  refreshUser: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string, displayName?: string) => Promise<void>;
  /** Sends a Firebase reset link. Resolves whether or not the address has an account, so it cannot be used
   * to discover which emails are registered. */
  sendPasswordReset: (email: string) => Promise<void>;
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
  // Read by `refreshUser` after an await, where the closure's `user` would be the one from when it started.
  const userRef = useRef(user);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const applyUser = useCallback((u: UserOut | null) => {
    setUser(u);
    setBalanceState(u?.coin_balance ?? 0);
    setStatus(u ? "signed_in" : "guest");
    // The last known profile, so a restore that cannot reach /me still has a user to show rather than a
    // signed-in screen with nobody on it. Not a secret: it is what the Me tab displays.
    void setJson("lastUser", u);
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
    if (!tokens.hasSession()) {
      applyUser(null);
      return;
    }
    // Keep whatever profile is already on screen; failing that, the one from the last run; failing that, the
    // session is stale until a refresh succeeds. `signed_in` never carries a null user.
    if (userRef.current) {
      setStatus("signed_in");
      return;
    }
    const cached = await getJson<UserOut>("lastUser");
    if (!tokens.hasSession()) {
      applyUser(null);
      return;
    }
    if (cached && !userRef.current) {
      setUser(cached);
      setBalanceState(cached.coin_balance);
      setStatus("signed_in");
      return;
    }
    setStatus(userRef.current ? "signed_in" : "stale");
  }, [applyUser]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      await tokens.load();
      if (cancelled) return;
      await refreshUser();
    })();
    const off = tokens.onSignedOut(() => {
      // The tokens are already gone, so the DELETE will not land; the local cache is what matters here, or
      // the next account on this device would think its push token was registered.
      void unregisterPush();
      applyUser(null);
    });
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

  /**
   * Password reset.
   *
   * There was no way back into an email account at all: forget the password and the account, its coins and
   * everything unlocked with them were simply gone. Firebase owns the credential, so it owns the reset.
   *
   * `auth/user-not-found` is swallowed deliberately. Reporting it turns this box into an oracle for which
   * addresses have accounts, and the caller shows the same "check your inbox" either way.
   */
  const sendPasswordReset = useCallback(async (email: string) => {
    try {
      await sendPasswordResetEmail(getFirebaseAuth(), email.trim());
    } catch (e) {
      const code = typeof e === "object" && e !== null && "code" in e ? String((e as { code: string }).code) : "";
      if (code === "auth/user-not-found" || code === "auth/invalid-email") return;
      throw e;
    }
  }, []);

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
    // Before the session is revoked, while the DELETE can still be authorised. Best effort either way.
    if (tokens.hasSession()) await unregisterPush();
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
      // A stale session may well still be good: try it again, and the modal closes itself if that succeeds.
      if (status === "stale") void refreshUser();
      const target = typeof returnTo === "string" ? returnTo : undefined;
      router.push({ pathname: "/auth", params: target ? { returnTo: target } : {} });
      return false;
    },
    [router, status, refreshUser],
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
      sendPasswordReset,
      signInWithGoogleIdToken,
      signInWithApple,
      signOut,
      applyUser,
      requireAuth,
    }),
    [status, user, balance, setBalance, refreshUser, signInWithEmail, signUpWithEmail, sendPasswordReset, signInWithGoogleIdToken, signInWithApple, signOut, applyUser, requireAuth],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

/** Map Firebase auth error codes to short human messages, in the viewer's language. */
export function firebaseErrorMessage(error: unknown, t: (key: string) => string): string {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
  switch (code) {
    case "auth/invalid-email":
      return t("auth.err_invalid_email");
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return t("auth.err_bad_credentials");
    case "auth/email-already-in-use":
      return t("auth.err_email_in_use");
    case "auth/weak-password":
      return t("auth.err_weak_password");
    case "auth/too-many-requests":
      return t("auth.err_too_many");
    case "auth/network-request-failed":
      return t("auth.err_network");
    default:
      if (error instanceof RequestError) return error.message;
      if (error instanceof Error && error.message) return error.message;
      return t("auth.err_generic");
  }
}
