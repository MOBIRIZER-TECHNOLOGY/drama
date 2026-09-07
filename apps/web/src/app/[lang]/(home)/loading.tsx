import { SeriesCardSkeleton } from "@/components/SeriesCard";

export default function Loading() {
  return (
    <div className="mx-auto max-w-[1400px] pb-12">
      <div className="px-0 sm:px-6 lg:px-8">
        <div className="k-skeleton aspect-[3/4] w-full sm:aspect-[16/8] sm:rounded-lg lg:aspect-[21/9]" />
      </div>
      {[0, 1].map((i) => (
        <div key={i} className="mt-10">
          <div className="k-skeleton mx-4 mb-3 h-6 w-40 rounded-sm sm:mx-6 lg:mx-8" />
          <div className="no-scrollbar flex gap-3 overflow-hidden px-4 sm:px-6 lg:px-8">
            {Array.from({ length: 7 }).map((_, j) => (
              <SeriesCardSkeleton key={j} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
