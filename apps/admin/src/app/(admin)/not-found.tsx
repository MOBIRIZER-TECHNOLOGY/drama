import Link from "next/link";
import { EmptyState } from "@/components/ui";

export default function AdminNotFound() {
  return (
    <div className="rounded-card border border-line bg-surface">
      <EmptyState
        title="Page not found"
        description="This section doesn't exist or was moved."
        action={
          <Link href="/dashboard" className="text-sm text-accent underline">
            Back to dashboard
          </Link>
        }
      />
    </div>
  );
}
