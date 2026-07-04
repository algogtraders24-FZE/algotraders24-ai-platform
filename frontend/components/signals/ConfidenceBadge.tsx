// components/signals/ConfidenceBadge.tsx
import type { ConfidenceScore } from "@/types/signal";
import { CONFIDENCE_THRESHOLDS } from "@/config/signal.config";

export default function ConfidenceBadge({ score }: { score: ConfidenceScore }) {
  const color =
    score >= CONFIDENCE_THRESHOLDS.high
      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
      : score >= CONFIDENCE_THRESHOLDS.medium
      ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
      : "bg-red-500/15 text-red-400 border-red-500/30";

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${color}`}>
      {score}%
    </span>
  );
}