"use client";

import type { ConfirmationResult, RecaptchaVerifier } from "firebase/auth";
import { useEffect, useRef, useState } from "react";
import { useApp, useT } from "@/lib/app-context";
import { REDIRECT_FLAG, useAuth } from "@/lib/auth-context";
import { firebaseErrorMessage, getFirebaseAuth } from "@/lib/firebase";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";
import { Field, inputClass } from "./ui/states";
import { IconGoogle } from "./ui/icons";

type Tab = "email" | "phone";

export function AuthDialog() {
  const t = useT();
  const { dialogOpen, closeAuth, firebaseConfigured } = useAuth();
  const [heading, setHeading] = useState<string | null>(null);

  return (
    <Dialog
      open={dialogOpen}
      onClose={closeAuth}
      title={heading ?? t("auth.sign_in_title", "Sign in to Katha")}
      closeLabel={t("common.close", "Close")}
    >
      {/* The body mounts fresh on every open so form state and the reCAPTCHA widget reset naturally. */}
      {dialogOpen && (firebaseConfigured ? <AuthBody onHeading={setHeading} /> : <FirebaseMissing />)}
    </Dialog>
  );
}

function AuthBody({ onHeading }: { onHeading: (h: string | null) => void }) {
  const t = useT();
  const { config } = useApp();
  const { exchange } = useAuth();
  const emailEnabled = config?.auth?.email !== false;
  const googleEnabled = config?.auth?.google !== false;
  const phoneEnabled = config?.auth?.phone !== false;

  const [tab, setTab] = useState<Tab>(emailEnabled || !phoneEnabled ? "email" : "phone");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recaptchaRef = useRef<RecaptchaVerifier | null>(null);
  const recaptchaHost = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const signup = mode === "signup" && tab === "email";
    onHeading(signup ? t("auth.create_account", "Create an account") : null);
  }, [mode, tab, onHeading, t]);

  useEffect(
    () => () => {
      recaptchaRef.current?.clear();
      recaptchaRef.current = null;
      onHeading(null);
    },
    [onHeading],
  );

  const finish = async (getToken: () => Promise<string>, method: string) => {
    const idToken = await getToken();
    const apiError = await exchange(idToken, method);
    if (apiError) setError(apiError.message);
  };

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(firebaseErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const notConfigured = () => new Error(t("auth.not_configured", "Sign-in is not configured yet."));

  const withEmail = () =>
    run("email", async () => {
      const fb = await getFirebaseAuth(config?.firebase);
      if (!fb) throw notConfigured();
      const { signInWithEmailAndPassword, createUserWithEmailAndPassword } = await import("firebase/auth");
      const cred =
        mode === "signin"
          ? await signInWithEmailAndPassword(fb, email.trim(), password)
          : await createUserWithEmailAndPassword(fb, email.trim(), password);
      await finish(() => cred.user.getIdToken(), "email");
    });

  const withGoogle = () =>
    run("google", async () => {
      const fb = await getFirebaseAuth(config?.firebase);
      if (!fb) throw notConfigured();
      const { GoogleAuthProvider, signInWithPopup, signInWithRedirect } = await import("firebase/auth");
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      try {
        const cred = await signInWithPopup(fb, provider);
        await finish(() => cred.user.getIdToken(), "google");
      } catch (e) {
        if ((e as { code?: string })?.code !== "auth/popup-blocked") throw e;
        // Popup blockers: fall back to a full-page redirect; AuthProvider completes the exchange on return.
        window.sessionStorage.setItem(REDIRECT_FLAG, "1");
        await signInWithRedirect(fb, provider);
      }
    });

  const sendCode = () =>
    run("phone", async () => {
      const fb = await getFirebaseAuth(config?.firebase);
      if (!fb || !recaptchaHost.current) throw notConfigured();
      const { RecaptchaVerifier, signInWithPhoneNumber } = await import("firebase/auth");
      if (!recaptchaRef.current) {
        recaptchaRef.current = new RecaptchaVerifier(fb, recaptchaHost.current, { size: "invisible" });
      }
      const result = await signInWithPhoneNumber(fb, phone.replace(/\s+/g, ""), recaptchaRef.current);
      setConfirmation(result);
    });

  const confirmCode = () =>
    run("code", async () => {
      if (!confirmation) return;
      const cred = await confirmation.confirm(code.trim());
      await finish(() => cred.user.getIdToken(), "phone");
    });

  const changeNumber = () => {
    setConfirmation(null);
    setCode("");
    setError(null);
    recaptchaRef.current?.clear();
    recaptchaRef.current = null;
  };

  return (
    <div className="flex flex-col gap-4">
      {googleEnabled && (
        <Button variant="secondary" size="lg" onClick={withGoogle} loading={busy === "google"} disabled={!!busy} className="w-full">
          <IconGoogle />
          {t("auth.continue_google", "Continue with Google")}
        </Button>
      )}

      {googleEnabled && (emailEnabled || phoneEnabled) && (
        <div className="flex items-center gap-3 text-xs text-muted">
          <span className="h-px flex-1 bg-line" />
          {t("common.or", "or")}
          <span className="h-px flex-1 bg-line" />
        </div>
      )}

      {emailEnabled && phoneEnabled && (
        <div role="tablist" className="grid grid-cols-2 rounded-pill border border-line bg-ground p-1 text-sm">
          {(["email", "phone"] as Tab[]).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => {
                setTab(k);
                setError(null);
              }}
              className={`rounded-pill py-1.5 transition-colors ${tab === k ? "bg-surface2 text-ink" : "text-muted hover:text-ink"}`}
            >
              {k === "email" ? t("auth.email", "Email") : t("auth.phone", "Phone")}
            </button>
          ))}
        </div>
      )}

      {tab === "email" && emailEnabled && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void withEmail();
          }}
          className="flex flex-col gap-3"
        >
          <Field label={t("auth.email", "Email")} htmlFor="auth-email">
            <input id="auth-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
          </Field>
          <Field label={t("auth.password", "Password")} htmlFor="auth-password">
            <input
              id="auth-password"
              type="password"
              required
              minLength={6}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Button type="submit" size="lg" loading={busy === "email"} disabled={!!busy} className="mt-1 w-full">
            {mode === "signin" ? t("auth.sign_in", "Sign in") : t("auth.sign_up", "Sign up free")}
          </Button>
          <p className="text-center text-sm text-muted">
            {mode === "signin" ? t("auth.no_account", "New to Katha?") : t("auth.have_account", "Already have an account?")}{" "}
            <button type="button" onClick={() => setMode((m) => (m === "signin" ? "signup" : "signin"))} className="font-medium text-accent hover:underline">
              {mode === "signin" ? t("auth.create_account", "Create an account") : t("auth.sign_in", "Sign in")}
            </button>
          </p>
        </form>
      )}

      {tab === "phone" && phoneEnabled && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void (confirmation ? confirmCode() : sendCode());
          }}
          className="flex flex-col gap-3"
        >
          <Field label={t("auth.phone_number", "Phone number")} htmlFor="auth-phone" hint={t("auth.phone_hint", "Include the country code, e.g. +91 98765 43210")}>
            <input
              id="auth-phone"
              type="tel"
              required
              autoComplete="tel"
              inputMode="tel"
              value={phone}
              disabled={!!confirmation}
              onChange={(e) => setPhone(e.target.value)}
              className={inputClass}
              dir="ltr"
            />
          </Field>
          {confirmation && (
            <Field label={t("auth.code", "Verification code")} htmlFor="auth-code">
              <input
                id="auth-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className={inputClass}
                dir="ltr"
              />
            </Field>
          )}
          <div ref={recaptchaHost} />
          <Button type="submit" size="lg" loading={busy === "phone" || busy === "code"} disabled={!!busy} className="mt-1 w-full">
            {confirmation ? t("auth.verify", "Verify") : t("auth.send_code", "Send code")}
          </Button>
          {confirmation && (
            <button type="button" onClick={changeNumber} className="text-center text-sm text-muted hover:text-ink">
              {t("auth.change_number", "Use a different number")}
            </button>
          )}
        </form>
      )}

      {error && (
        <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function FirebaseMissing() {
  const t = useT();
  return (
    <div className="rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-ink2">
      <p className="font-medium text-warning">{t("auth.not_configured", "Sign-in is not configured yet.")}</p>
      <p className="mt-1 text-muted">
        {t(
          "auth.not_configured_hint",
          "Add the Firebase web config to the API settings or the NEXT_PUBLIC_FIREBASE_* environment variables to enable email, Google and phone sign-in. You can keep browsing in the meantime.",
        )}
      </p>
    </div>
  );
}
