"use client";

import { ErrorState } from "@/components/ui";

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="rounded-card border border-line bg-surface">
      <ErrorState message={error.message || "Something went wrong rendering this page."} onRetry={reset} />
      {error.digest && <p className="pb-4 text-center font-mono text-[11px] text-muted">ref {error.digest}</p>}
    </div>
  );
}
