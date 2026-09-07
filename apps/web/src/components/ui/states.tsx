"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useT } from "@/lib/app-context";
import type { ApiError } from "@/lib/errors";
import { Button } from "./Button";
import { IconAlert } from "./icons";

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`k-skeleton rounded-md ${className}`} />;
}

export function EmptyState({
  icon,
  title,
  message,
  action,
  className = "",
}: {
  icon?: ReactNode;
  title: string;
  message?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-line px-6 py-12 text-center ${className}`}
    >
      {icon && <div className="text-muted">{icon}</div>}
      <h3 className="font-display text-lg font-semibold text-ink">{title}</h3>
      {message && <p className="max-w-sm text-sm text-muted">{message}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title,
  message,
  error,
  onRetry,
  retryLabel,
  className = "",
}: {
  title?: string;
  message?: string;
  /** Preferred over `message`: network and auth failures get translated copy instead of the raw API text. */
  error?: ApiError | null;
  onRetry?: () => void | Promise<void>;
  retryLabel?: string;
  className?: string;
}) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const resolvedTitle = title ?? t("common.error_title", "Something went wrong");
  const resolvedRetry = retryLabel ?? t("common.retry", "Try again");
  const resolvedMessage =
    error?.code === "network_error"
      ? t("common.network_error", "We could not reach Katha. Check your connection and try again.")
      : error?.code === "unauthorized"
        ? t("common.sign_in_again", "Your session has ended. Please sign in again.")
        : error?.code === "validation_error"
          ? t("common.validation_error", "Some of the details were not accepted.")
          : (message ?? error?.message ?? t("common.error_generic", "Please try again in a moment."));
  const retry = async () => {
    setBusy(true);
    try {
      if (onRetry) await onRetry();
      else router.refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      role="alert"
      className={`flex flex-col items-center justify-center gap-3 rounded-lg border border-danger/30 bg-surface px-6 py-10 text-center ${className}`}
    >
      <IconAlert size={28} className="text-danger" />
      <h3 className="font-display text-lg font-semibold text-ink">{resolvedTitle}</h3>
      {resolvedMessage && <p className="max-w-sm text-sm text-muted">{resolvedMessage}</p>}
      <Button variant="secondary" size="sm" onClick={retry} loading={busy} className="mt-1">
        {resolvedRetry}
      </Button>
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium uppercase tracking-wide text-muted">
        {label}
      </label>
      {children}
      {error ? <p className="text-xs text-danger">{error}</p> : hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export const inputClass =
  "h-11 w-full rounded-md border border-line bg-ground px-3 text-sm text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none disabled:opacity-60";
