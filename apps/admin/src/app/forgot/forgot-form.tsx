"use client";

import { useState, type FormEvent } from "react";
import { api, call } from "@/lib/api";
import { Button, Field, Input } from "@/components/ui";

export function ForgotForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // The API always answers 200 so an address cannot be probed; the copy stays deliberately vague.
      await call(api.POST("/v1/admin/auth/forgot", { body: { email: email.trim() } }));
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the reset link");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-card border border-line bg-surface p-6">
        <h1 className="text-xl font-semibold leading-tight">Check your inbox</h1>
        <p role="status" className="mt-2 text-sm text-ink-2">
          If an active admin account uses <strong className="break-all">{email.trim()}</strong>, a reset link is on its way. The link works once and expires in 30 minutes.
        </p>
        <Button className="mt-4 w-full" onClick={() => setSent(false)}>
          Use a different address
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-card border border-line bg-surface p-6" noValidate>
      <div className="mb-6 flex items-center gap-2">
        <span aria-hidden className="grid h-8 w-8 place-items-center rounded-lg bg-accent font-display text-base font-bold text-white">
          K
        </span>
        <div>
          <h1 className="text-xl font-semibold leading-tight">Reset your password</h1>
          <p className="text-xs text-muted">We&apos;ll email you a link to choose a new one</p>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <Field label="Email" required>
          <Input
            type="email"
            autoComplete="username"
            data-autofocus
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
          />
        </Field>
        {error && (
          <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" loading={busy} disabled={!email.trim()} className="mt-1 w-full">
          Send reset link
        </Button>
      </div>
    </form>
  );
}
