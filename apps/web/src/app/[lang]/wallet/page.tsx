import type { Metadata } from "next";
import { Suspense } from "react";
import { WalletView } from "@/components/wallet/WalletView";
import { Skeleton } from "@/components/ui/states";

// Account pages are per-user and never cached.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Wallet", robots: { index: false } };

export default function WalletPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <WalletView />
      </Suspense>
    </div>
  );
}
