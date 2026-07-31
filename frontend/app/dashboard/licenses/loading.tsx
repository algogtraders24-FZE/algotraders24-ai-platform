// app/dashboard/licenses/loading.tsx
// Sprint R1.0.1 - licenses/page.tsx is an async Server Component with no
// prior loading state at all.
// Sprint D1.0 - Rebuilt on the shared Skeleton primitive.
import Skeleton from "@/components/ui/Skeleton";

export default function LicensesLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-7 w-40" />
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-40" />
        ))}
      </div>
    </div>
  );
}
