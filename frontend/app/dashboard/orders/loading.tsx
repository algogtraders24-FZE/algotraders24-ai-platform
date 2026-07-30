// app/dashboard/orders/loading.tsx
// Sprint R1.0.1 - orders/page.tsx is an async Server Component with no
// prior loading state at all (a blank page while the data fetch resolves).
// Matches app/dashboard/loading.tsx's animate-pulse convention.
function Block({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-2xl border border-[#1F2937] bg-[#0C1324] ${className}`} />;
}

export default function OrdersLoading() {
  return (
    <div className="space-y-6">
      <div className="h-7 w-36 animate-pulse rounded-lg bg-[#0C1324]" />
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {[0, 1, 2].map((i) => (
          <Block key={i} className="h-40" />
        ))}
      </div>
    </div>
  );
}
