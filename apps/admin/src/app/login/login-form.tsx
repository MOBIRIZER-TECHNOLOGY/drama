"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, call } from "@/lib/api";
import { setToken } from "@/lib/token";
import { Button, Field, Input } from "@/components/ui";

/** Only same-origin paths (never /login itself) are honoured; anything else falls back to the dashboard. */
function safeNext(next: string | null): string {
  if (!next) return "/dashboard";
  try {
    const url = new URL(next, window.location.origin);
    if (url.origin !== window.location.origin) return "/dashboard";
    if (url.pathname === "/login" || url.pathname.startsWith("/login/")) return "/dashboard";
    if (!url.pathname.startsWith("/") || url.pathname.startsWith("//")) return "/dashboard";
    return url.pathname + url.search;
  } catch {
    return "/dashboard";
  }
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");
  const expired = params.get("reason") === "expired";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const token = await call(api.POST("/v1/admin/auth/login", { body: { email: email.trim(), password } }));
      setToken(token.access_token, token.expires_in);
      router.replace(safeNext(next));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm rounded-card border border-line bg-surface p-6" noValidate>
      <div className="mb-6 flex items-center gap-2">
        <span aria-hidden className="grid h-8 w-8 place-items-center rounded-lg bg-accent font-display text-base font-bold text-white">
          K
        </span>
        <div>
          <h1 className="text-xl font-semibold leading-tight">Katha Admin</h1>
          <p className="text-xs text-muted">Sign in with your admin account</p>
        </div>
      </div>

      {expired && !error && (
        <p role="status" className="mb-4 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          Your session expired. Please sign in again.
        </p>
      )}

      <div className="flex flex-col gap-4">
        <Field label="Email" required>
          <Input
            type="email"
            autoComplete="username"
            data-autofocus
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Password" required>
          <Input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <p className="-mt-2 text-right text-xs">
          <Link href="/forgot" className="text-muted hover:text-accent hover:underline">
            Forgot your password?
          </Link>
        </p>
        {error && (
          <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" loading={busy} disabled={!email || !password} className="mt-1 w-full">
          Sign in
        </Button>
      </div>
    </form>
  );
}
