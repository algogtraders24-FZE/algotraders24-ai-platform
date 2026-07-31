// app/dashboard/loading.tsx
// Sprint L2.3 - Next's App Router convention: this file automatically
// wraps app/dashboard/page.tsx's async data-fetching in a Suspense
// boundary, showing this fallback until the real getOverview()/
// getRecentActivity() queries resolve. Shaped to match the real page's
// layout exactly - welcome header, profile row, 4 stat cards, activity +
// quick actions - rather than a generic spinner, so the transition into
// real content doesn't jump around.
// Sprint D1.0 - Rebuilt on the shared Skeleton primitive instead of a
// locally-defined Block using bg-ink-2/border-border.
import Skeleton from "@/components/ui/Skeleton";

export default function DashboardLoading() {
  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-9 w-24" />
      </div>

      <Skeleton className="h-20" />

      <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-56" />
        <Skeleton className="h-56" />
      </div>
    </div>
  );
}
