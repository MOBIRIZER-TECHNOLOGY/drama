import { SeriesCardSkeleton } from "@/components/SeriesCard";

/** Rail-shaped skeleton: navigating here used to leave the previous page frozen while N category calls resolved. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 lg:px-8">
      <div className="k-skeleton mb-2 h-8 w-48 rounded-sm" />
      <div className="k-skeleton mb-8 h-4 w-72 rounded-sm" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="mb-10">
          <div className="k-skeleton mb-3 h-6 w-40 rounded-sm" />
          <div className="no-scrollbar flex gap-3 overflow-hidden">
            {Array.from({ length: 7 }).map((_, j) => (
              <SeriesCardSkeleton key={j} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
