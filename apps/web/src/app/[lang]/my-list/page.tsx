import type { Metadata } from "next";
import { MyListView } from "@/components/MyListView";

// Account pages are per-user and never cached.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "My List", robots: { index: false } };

export default function MyListPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <MyListView />
    </div>
  );
}
