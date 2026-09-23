// components/ui/LoadingState.tsx
// Sprint UI-01 - AT24 Premium UI Foundation. Named Skeleton compositions for
// the shapes that recur across the app (a full page's first paint, a stat
// row, a table, a single card) instead of every page hand-assembling its
// own stack of <Skeleton> blocks with slightly different heights/gaps, the
// way app/dashboard/loading.tsx did before this sprint.
import Skeleton from "./Skeleton";

export type LoadingStateVariant = "page" | "statRow" | "table" | "card";

export interface LoadingStateProps {
  variant?: LoadingStateVariant;
  /** "table" only - number of skeleton rows. */
  rows?: number;
  className?: string;
}

export default function LoadingState({ variant = "card", rows = 5, className = "" }: LoadingStateProps) {
  if (variant === "page") {
    return (
      <div className={["space-y-8", className].filter(Boolean).join(" ")}>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-64" />
            <Skeleton className="h-4 w-48" />
          </div>
          <Skeleton className="h-9 w-28" />
        </div>
        <LoadingState variant="statRow" />
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
      </div>
    );
  }

  if (variant === "statRow") {
    return (
      <div className={["grid grid-cols-2 gap-4 lg:grid-cols-4", className].filter(Boolean).join(" ")}>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }

  if (variant === "table") {
    return (
      <div className={["space-y-2", className].filter(Boolean).join(" ")}>
        <Skeleton className="h-9" />
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-10" />
        ))}
      </div>
    );
  }

  return <Skeleton className={["h-40", className].filter(Boolean).join(" ")} />;
}
