// components/quant-lite/CoverageAssessmentPanel.tsx
// Q1.1.7/8/9/10 - the single place data-quality transparency is rendered,
// reused on Backtest Setup (before submit) and Results (above the fold,
// alongside execution assumptions) so the two screens can never show
// different numbers for the same request. Every field here comes
// straight from a server-computed CoverageAssessment - nothing is
// re-derived or approximated client-side (Q1.1.41).
import Badge from "@/components/ui/Badge";
import Card from "@/components/ui/Card";
import StatField from "@/components/workspace/StatField";
import type { CoverageAssessment, DataQualityGrade } from "@/types/quant-lite-coverage";

const GRADE_TONE: Record<DataQualityGrade, "success" | "neutral" | "danger"> = {
  NONE: "success",
  LOW: "success",
  MEDIUM: "neutral",
  HIGH: "danger",
  CRITICAL: "danger",
};

const POLICY_LABEL: Record<CoverageAssessment["policy"], string> = {
  SUPPORTED: "Supported",
  SUPPORTED_WITH_WARNING: "Supported - data gaps present",
  RESTRICTED: "Restricted - fragmented data",
  DATA_UNAVAILABLE: "Not available",
};

export default function CoverageAssessmentPanel({ assessment, loading }: { assessment: CoverageAssessment | null | undefined; loading?: boolean }) {
  if (loading) {
    return (
      <Card>
        <p className="text-sm text-text-3">Checking real data coverage for this range...</p>
      </Card>
    );
  }
  if (!assessment) return null;

  const isRestricted = assessment.policy === "RESTRICTED";
  const isWarning = assessment.policy === "SUPPORTED_WITH_WARNING";

  return (
    <Card className={isRestricted ? "border-danger/40" : isWarning ? "border-info/40" : undefined}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-text">Data Coverage</p>
        <Badge tone={isRestricted ? "danger" : isWarning ? "neutral" : "success"}>{POLICY_LABEL[assessment.policy]}</Badge>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatField label="Requested">
          {assessment.requested.start} &rarr; {assessment.requested.end}
        </StatField>
        <StatField label="Actual usable">
          {assessment.actual.start} &rarr; {assessment.actual.end}
        </StatField>
        <StatField label="Coverage">{assessment.coveragePct}%</StatField>
        <StatField label="Largest gap">{assessment.largestGapDays.toFixed(1)} days</StatField>
        <StatField label="Gaps in range">{assessment.gapCountInRange}</StatField>
        <StatField label="Quality">
          <span className={GRADE_TONE[assessment.worstSeverity] === "danger" ? "text-danger" : undefined}>{assessment.worstSeverity}</span>
        </StatField>
      </div>
      {(isRestricted || isWarning) && (
        <p className={`mt-3 rounded-control border p-2 text-xs ${isRestricted ? "border-danger/30 bg-danger/10 text-danger" : "border-info/30 bg-info/10 text-text-2"}`}>
          {assessment.message}
        </p>
      )}
      {assessment.performanceWarning && (
        <p className="mt-3 rounded-control border border-border bg-ink-2 p-2 text-xs text-text-2">
          <span className="font-semibold text-text">Performance notice:</span> {assessment.performanceWarning}
        </p>
      )}
    </Card>
  );
}
