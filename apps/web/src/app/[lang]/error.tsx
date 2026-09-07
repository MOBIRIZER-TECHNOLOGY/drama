"use client";

import { ErrorState } from "@/components/ui/states";
import { useT } from "@/lib/app-context";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT();
  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <ErrorState
        title={t("common.error_title", "Something went wrong")}
        message={error.digest ? t("common.error_reference", "Reference {ref}", { ref: error.digest }) : t("common.error_generic", "Please try again in a moment.")}
        onRetry={reset}
      />
    </div>
  );
}
