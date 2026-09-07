"use client";

import Link from "next/link";
import { useEffect } from "react";
import { buttonClass } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/states";
import { track } from "@/lib/analytics";
import { useHref, useT } from "@/lib/app-context";

/**
 * Route-level error boundary.
 *
 * It used to render `t("common.error_reference", "Reference {ref}")` as the *message* whenever a digest existed,
 * so a viewer whose page broke read "Reference 7f3a1c" and no explanation at all. The explanation is the
 * message; the digest is a caption for a support ticket.
 *
 * It also reported nothing, which meant production render failures were invisible — the server log has no idea
 * a client component threw.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT();
  const href = useHref();

  useEffect(() => {
    track("client_error", {
      digest: error.digest ?? null,
      message: error.message.slice(0, 200),
      path: typeof window !== "undefined" ? window.location.pathname : null,
    });
  }, [error]);

  const offline = typeof navigator !== "undefined" && navigator.onLine === false;

  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <ErrorState
        title={offline ? t("common.offline_title", "You are offline") : t("common.error_title", "Something went wrong")}
        message={
          offline
            ? t("common.offline_message", "Check your connection and try again.")
            : t("common.error_generic", "Please try again in a moment.")
        }
        onRetry={reset}
      />
      {/* A second way out: reset() on a persistently failing route only re-renders the same error. */}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <Link href={href("/")} className={buttonClass("secondary", "sm")}>
          {t("common.go_home", "Go to home")}
        </Link>
        <Link href={href("/contact")} className={buttonClass("ghost", "sm")}>
          {t("common.contact_support", "Contact support")}
        </Link>
      </div>
      {error.digest && (
        <p className="mt-3 text-center text-xs text-muted">
          {t("common.error_reference", "Reference {ref}", { ref: error.digest })}
        </p>
      )}
    </div>
  );
}
