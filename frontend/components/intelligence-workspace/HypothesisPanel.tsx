// components/intelligence-workspace/HypothesisPanel.tsx
// Sprint D2.6.10 - Trader Intelligence Workspace & Verified Answer
// Experience. Renders real DecisionHypothesisContext[] (D2.6.1, sourced
// from D2.5.3's deterministic Hypothesis Engine) - a falsifiable CURRENT
// VIEW, never a guaranteed prediction. Copy deliberately avoids "will
// happen"; uses "current hypothesis"/"invalidated if" per the sprint's
// own required phrasing. May legitimately render nothing (not every
// regime generates a hypothesis) - callers should skip this section
// entirely when hypotheses.length === 0, never show an empty shell.
import type { DecisionHypothesisContext, DecisionInvalidationItem } from "@/types/intelligence-decision-context";
import { formatLabel } from "./format";
import { formatQuantity } from "@/lib/financial-format";

function HypothesisCard({ hypothesis, invalidation }: { hypothesis: DecisionHypothesisContext; invalidation?: DecisionInvalidationItem }) {
  return (
    <div className="rounded-card border border-border bg-ink-2 p-4">
      <p className="text-sm font-semibold text-text">Current hypothesis — {formatLabel(hypothesis.type)}</p>
      <p className="mt-1 text-sm leading-6 text-text-2">{hypothesis.claim}</p>

      <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
        <div>
          <dt className="uppercase tracking-wider text-text-3">Prediction Window</dt>
          <dd className="mt-0.5 text-text-2">
            <span className="fin-num font-mono">{formatQuantity(hypothesis.predictionWindow.candles)}</span> candles ({hypothesis.predictionWindow.timeframe})
          </dd>
        </div>
        <div>
          <dt className="uppercase tracking-wider text-text-3">Invalidated If</dt>
          <dd className="mt-0.5 text-text-2">{invalidation?.description ?? hypothesis.invalidationCondition.description}</dd>
        </div>
      </dl>

      {hypothesis.supportingEvidence.length > 0 && (
        <p className="mt-3 text-xs text-text-3">
          Could continue if the {hypothesis.supportingEvidence.length} supporting evidence item(s) above remain unopposed.
        </p>
      )}
    </div>
  );
}

export default function HypothesisPanel({
  hypotheses,
  invalidationConditions,
}: {
  hypotheses: DecisionHypothesisContext[];
  invalidationConditions: DecisionInvalidationItem[];
}) {
  if (hypotheses.length === 0) return null;
  const invalidationByHypothesisId = new Map(invalidationConditions.map((i) => [i.hypothesisId, i]));

  return (
    <div className="space-y-3">
      {hypotheses.map((h) => (
        <HypothesisCard key={h.hypothesisId} hypothesis={h} invalidation={invalidationByHypothesisId.get(h.hypothesisId)} />
      ))}
    </div>
  );
}
