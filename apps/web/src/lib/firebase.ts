import type { FirebaseApp } from "firebase/app";
import type { Auth } from "firebase/auth";
import type { FirebaseWebConfig as RemoteFirebaseConfig } from "./types";

export type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  messagingSenderId?: string;
  storageBucket?: string;
};

/**
 * Public Firebase web config. Values from `GET /v1/config` (`config.firebase`) take precedence over the
 * `NEXT_PUBLIC_FIREBASE_*` env vars, field by field, so one source can fill gaps in the other.
 */
export function firebaseConfig(remote?: RemoteFirebaseConfig | null): FirebaseWebConfig | null {
  const apiKey = remote?.api_key || process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authDomain = remote?.auth_domain || process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const projectId = remote?.project_id || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const appId = remote?.app_id || process.env.NEXT_PUBLIC_FIREBASE_APP_ID;
  if (!apiKey || !authDomain || !projectId || !appId) return null;
  return {
    apiKey,
    authDomain,
    projectId,
    appId,
    messagingSenderId: remote?.messaging_sender_id || process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || undefined,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || undefined,
  };
}

export const isFirebaseConfigured = (remote?: RemoteFirebaseConfig | null): boolean => firebaseConfig(remote) !== null;

let appPromise: Promise<FirebaseApp> | null = null;

/** Lazily loads the Firebase SDK (kept out of the main bundle) and returns the Auth instance, or null when unconfigured. */
export async function getFirebaseAuth(remote?: RemoteFirebaseConfig | null): Promise<Auth | null> {
  const cfg = firebaseConfig(remote);
  if (!cfg || typeof window === "undefined") return null;
  if (!appPromise) {
    appPromise = import("firebase/app").then(({ getApps, initializeApp }) =>
      getApps()[0] ?? initializeApp(cfg),
    );
  }
  const app = await appPromise;
  const { getAuth } = await import("firebase/auth");
  return getAuth(app);
}

/** Map Firebase auth error codes to friendly copy. */
export function firebaseErrorMessage(err: unknown): string {
  const code = (err as { code?: string })?.code ?? "";
  switch (code) {
    case "auth/invalid-email":
      return "That email address does not look right.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Email or password is incorrect.";
    case "auth/email-already-in-use":
      return "An account with this email already exists. Try signing in.";
    case "auth/weak-password":
      return "Choose a password with at least 6 characters.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a moment and try again.";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "The sign-in window was closed before finishing.";
    case "auth/popup-blocked":
      return "Your browser blocked the sign-in popup. Allow popups and try again.";
    case "auth/invalid-phone-number":
      return "Enter the phone number in international format, e.g. +91 98765 43210.";
    case "auth/invalid-verification-code":
      return "That code is not correct.";
    case "auth/code-expired":
      return "The code has expired. Request a new one.";
    case "auth/network-request-failed":
      return "Network error. Check your connection and try again.";
    case "auth/operation-not-allowed":
      return "This sign-in method is not enabled for this project.";
    default:
      return (err as { message?: string })?.message ?? "Sign-in failed. Please try again.";
  }
}
