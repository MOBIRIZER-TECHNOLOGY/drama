import type { Metadata } from "next";
import { LedgerView } from "@/components/wallet/LedgerView";

// Account pages are per-user and never cached.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Transaction history", robots: { index: false } };

export default function WalletHistoryPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <LedgerView />
    </div>
  );
}
