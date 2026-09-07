import type { Metadata } from "next";
import { ProfileView } from "@/components/ProfileView";

// Account pages are per-user and never cached.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Profile", robots: { index: false } };

export default function ProfilePage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <ProfileView />
    </div>
  );
}
