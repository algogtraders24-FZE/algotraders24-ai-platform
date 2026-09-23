// app/dashboard/loading.tsx
// Sprint L2.3 - Next's App Router convention: this file automatically
// wraps app/dashboard/page.tsx's async data-fetching in a Suspense
// boundary, showing this fallback until the real getOverview()/
// getRecentActivity() queries resolve. Shaped to match the real page's
// layout so the transition into real content doesn't jump around.
// Sprint UI-01 - now the shared LoadingState("page") composition instead of
// a locally hand-assembled stack of <Skeleton> blocks.
import LoadingState from "@/components/ui/LoadingState";

export default function DashboardLoading() {
  return <LoadingState variant="page" />;
}
