// app/dashboard/orders/loading.tsx
// Sprint R1.0.1 - orders/page.tsx is an async Server Component with no
// prior loading state at all.
// Sprint D1.0 - Rebuilt on the shared Skeleton primitive.
import Skeleton from "@/components/ui/Skeleton";

export default function OrdersLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-7 w-36" />
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-40" />
        ))}
      </div>
    </div>
  );
}
