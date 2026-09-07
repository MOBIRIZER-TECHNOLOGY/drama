"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { SeriesForm } from "@/components/dramas/series-form";
import { PageHeader } from "@/components/ui";

export default function NewSeriesPage() {
  const router = useRouter();
  return (
    <>
      <PageHeader
        title="New series"
        description="Fill in the original-language title first; other languages can follow later."
        actions={
          <Link href="/dramas" className="text-sm text-muted hover:text-ink">
            ← Back to dramas
          </Link>
        }
      />
      <SeriesForm onSaved={(s) => router.replace(`/dramas/${s.id}`)} />
    </>
  );
}
