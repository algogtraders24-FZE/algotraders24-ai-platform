// app/dashboard/loading.tsx
// Sprint L2.3 - Next's App Router convention: this file automatically
// wraps app/dashboard/page.tsx's async data-fetching in a Suspense
// boundary, showing this fallback until the real getOverview()/
// getRecentActivity() queries resolve. Replaces what was previously no
// loading state at all (the page rendered from synchronous mock calls, so
// there was never anything to wait for). Shaped to match the real page's
// layout exactly - welcome header, profile row, 4 stat cards, activity +
// quick actions - rather than a generic spinner, so the transition into
// real content doesn't jump around. Uses the same animate-pulse
// convention already established on the Knowledge and Billing dashboard
// pages, and is automatically dampened by the global
// prefers-reduced-motion gate in app/globals.css.
function Block({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-2xl border border-[#1F2937] bg-[#0C1324] ${className}`} />;
}

export default function DashboardLoading() {
  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <div className="h-7 w-64 animate-pulse rounded-lg bg-[#0C1324]" />
          <div className="h-4 w-48 animate-pulse rounded bg-[#0C1324]" />
        </div>
        <div className="h-9 w-24 animate-pulse rounded-lg bg-[#0C1324]" />
      </div>

      <Block className="h-20" />

      <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Block key={i} className="h-24" />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Block className="h-56" />
        <Block className="h-56" />
      </div>
    </div>
  );
}
