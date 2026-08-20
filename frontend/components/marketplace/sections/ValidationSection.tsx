// components/marketplace/sections/ValidationSection.tsx
// Sprint M8 - Every dimension listed explicitly (M8 brief section 11).
// Unavailable dimensions show UNAVAILABLE/INCONCLUSIVE verbatim - never
// hidden, never silently omitted from the list.
import Badge from "@/components/ui/Badge";
import type { BadgeTone } from "@/components/ui/Badge";
import type { ValidationSummary } from "@/types/marketplace";

const REQUIRED_DIMENSIONS = [
  "OUT_OF_SAMPLE",
  "WALK_FORWARD",
  "TEMPORAL_STABILITY",
  "REGIME_COVERAGE",
  "PERFORMANCE_DISTRIBUTION",
  "PARAMETER_SENSITIVITY",
  "SAMPLE_SIZE",
];

const STATUS_TONE: Record<string, BadgeTone> = {
  PASS: "success",
  WARNING: "warning",
  FAIL: "danger",
  INCONCLUSIVE: "neutral",
  UNAVAILABLE: "neutral",
};

export default function ValidationSection({ validation }: { validation: ValidationSummary | null }) {
  const byType = new Map((validation?.dimensions ?? []).map((d) => [d.validationType, d.status]));

  return (
    <section aria-labelledby="validation-heading" className="rounded-2xl bg-ink-3 border border-border p-6">
      <h2 id="validation-heading" className="text-xl font-bold mb-1">
        Validation
      </h2>
      {validation ? (
        <>
          <p className="text-xs text-text-3 mb-4">
            Overall status: <Badge tone={STATUS_TONE[validation.overallStatus] ?? "neutral"}>{validation.overallStatus}</Badge>
            {validation.methodologyVersion && <span className="ml-2">({validation.methodologyVersion})</span>}
          </p>
          <ul className="space-y-2">
            {REQUIRED_DIMENSIONS.map((dim) => {
              const status = byType.get(dim) ?? "UNAVAILABLE";
              return (
                <li key={dim} className="flex items-center justify-between text-sm border-b border-border/60 pb-2 last:border-0">
                  <span className="text-text-2">{dim.replace(/_/g, " ")}</span>
                  <Badge tone={STATUS_TONE[status] ?? "neutral"}>{status}</Badge>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <p className="text-sm text-text-3">No AT24 validation has been run for this listing yet. Validation unavailable.</p>
      )}
    </section>
  );
}
