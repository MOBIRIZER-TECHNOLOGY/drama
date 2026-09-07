import type { Metadata } from "next";
import { RewardsView } from "@/components/rewards/RewardsView";

// Account pages are per-user and never cached.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Rewards", robots: { index: false } };

export default function RewardsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <RewardsView />
    </div>
  );
}
