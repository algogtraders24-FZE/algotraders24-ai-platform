// components/signals/ConfidenceBadge.tsx
import type { ConfidenceScore } from "@/types/signal";
import { CONFIDENCE_THRESHOLDS } from "@/config/signal.config";

export default function ConfidenceBadge({ score }: { score: ConfidenceScore }) {
  const color =
    score >= CONFIDENCE_THRESHOLDS.high
      ? "bg-success/15 text-success border-success/30"
      : score >= CONFIDENCE_THRESHOLDS.medium
      ? "bg-warning/15 text-warning border-warning/30"
      : "bg-danger/15 text-danger border-danger/30";

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${color}`}>
      {score}%
    </span>
  );
}