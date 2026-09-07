"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, call } from "@/lib/api";
import { useFieldErrors } from "@/lib/forms";
import { Button, Field, Input } from "@/components/ui";

/** Mirrors the API rule (`ResetIn` requires 10+ characters). */
const MIN_PASSWORD = 10;

export function ResetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const { errors, setErrors, clearError, formRef } = useFieldErrors<"password" | "confirm">();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next: { password?: string; confirm?: string } = {};
    if (password.length < MIN_PASSWORD) next.password = `Use at least ${MIN_PASSWORD} characters.`;
    if (confirm !== password) next.confirm = "The two passwords do not match.";
    setErrors(next);
    if (Object.keys(next).length) return;

    setBusy(true);
    setError(null);
    try {
      await call(api.POST("/v1/admin/auth/reset", { body: { token, password } }));
      setDone(true);
      // The reset does not sign you in: send them to the login form with the new password.
      setTimeout(() => router.replace("/login"), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset the password");
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="rounded-card border border-line bg-surface p-6">
        <h1 className="text-xl font-semibold leading-tight">Link is incomplete</h1>
        <p role="alert" className="mt-2 text-sm text-ink-2">
          This page needs the reset token from the email link. Open the link again, or request a new one.
        </p>
        <Link
          href="/forgot"
          className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-lg border border-transparent bg-accent px-4 text-sm font-medium text-white hover:brightness-95"
        >
          Request a new link
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="rounded-card border border-line bg-surface p-6">
        <h1 className="text-xl font-semibold leading-tight">Password updated</h1>
        <p role="status" className="mt-2 text-sm text-ink-2">
          Sign in with your new password. Taking you to the sign-in page…
        </p>
        <Link
          href="/login"
          className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-lg border border-transparent bg-accent px-4 text-sm font-medium text-white hover:brightness-95"
        >
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <form ref={formRef} onSubmit={submit} className="rounded-card border border-line bg-surface p-6" noValidate>
      <div className="mb-6 flex items-center gap-2">
        <span aria-hidden className="grid h-8 w-8 place-items-center rounded-lg bg-accent font-display text-base font-bold text-white">
          K
        </span>
        <div>
          <h1 className="text-xl font-semibold leading-tight">Choose a new password</h1>
          <p className="text-xs text-muted">The link expires 30 minutes after it was sent</p>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <Field label="New password" required error={errors.password} hint={`At least ${MIN_PASSWORD} characters.`}>
          <Input
            type="password"
            autoComplete="new-password"
            data-autofocus
            required
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              clearError("password");
            }}
          />
        </Field>
        <Field label="Confirm password" required error={errors.confirm}>
          <Input
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              clearError("confirm");
            }}
          />
        </Field>
        {error && (
          <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
            {/^.*(invalid|expired).*$/i.test(error) && (
              <>
                {" "}
                <Link href="/forgot" className="underline">
                  Request a new link
                </Link>
                .
              </>
            )}
          </p>
        )}
        <Button type="submit" variant="primary" loading={busy} disabled={!password || !confirm} className="mt-1 w-full">
          Set new password
        </Button>
      </div>
    </form>
  );
}
