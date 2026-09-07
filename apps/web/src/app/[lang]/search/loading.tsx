import { SeriesCardSkeleton } from "@/components/SeriesCard";

/** Grid-shaped skeleton matching the real page, so the layout does not jump when results land. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 lg:px-8">
      <div className="k-skeleton mb-2 h-8 w-56 rounded-sm" />
      <div className="k-skeleton mb-8 h-4 w-64 rounded-sm" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {Array.from({ length: 12 }).map((_, i) => (
          <SeriesCardSkeleton key={i} className="w-full" />
        ))}
      </div>
    </div>
  );
}
