"use client";

import type { ReactNode } from "react";
import { useT } from "@/lib/app-context";
import { useAuth } from "@/lib/auth-context";
import { FirebaseMissing } from "./AuthDialog";
import { Button } from "./ui/Button";
import { EmptyState, Skeleton } from "./ui/states";
import { IconUser } from "./ui/icons";

/** Gate for account pages: skeleton while the session loads, a sign-in prompt when anonymous. */
export function RequireAuth({
  children,
  title,
  message,
  fallback,
}: {
  children: ReactNode;
  title?: string;
  message?: string;
  fallback?: ReactNode;
}) {
  const t = useT();
  const { status, openAuth, firebaseConfigured } = useAuth();

  if (status === "loading") {
    return (
      fallback ?? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      )
    );
  }
  if (status === "anonymous") {
    return (
      <div className="flex flex-col gap-4">
        {!firebaseConfigured && <FirebaseMissing />}
        <EmptyState
          icon={<IconUser size={32} />}
          title={title ?? t("auth.required_title", "Sign in to continue")}
          message={message ?? t("auth.required_message", "Your coins, favourites and watch history live on your account.")}
          action={
            <Button onClick={openAuth} disabled={!firebaseConfigured}>
              {t("auth.sign_in", "Sign in")}
            </Button>
          }
        />
      </div>
    );
  }
  return <>{children}</>;
}

export function PageTitle({ children, sub, aside }: { children: ReactNode; sub?: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink sm:text-3xl">{children}</h1>
        {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      </div>
      {aside}
    </div>
  );
}
