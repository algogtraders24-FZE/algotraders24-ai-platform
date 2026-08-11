"use client";
// components/intelligence-workspace/IntelligenceScorePanel.tsx
// Sprint D2.6.10 - Trader Intelligence Workspace & Verified Answer
// Experience. Renders the real, unmodified D2.5.5 IntelligenceScore -
// never recalculated in the frontend. A component whose
// dataAvailable === false is shown as "Unavailable" with its own real
// basis text, never displayed as a fabricated 0.
import { useState } from "react";
import type { IntelligenceScore, IntelligenceScoreComponentKey } from "@/types/intelligence-score";
import InfoTooltip from "@/components/ui/InfoTooltip";

const COMPONENT_LABELS: Record<IntelligenceScoreComponentKey, string> = {
  dataQuality: "Data Quality",
  evidenceQuality: "Evidence Quality",
  evidenceAgreement: "Evidence Agreement",
  marketStateQuality: "MarketState Quality",
  regimeConfidence: "Regime Confidence",
  hypothesisStrength: "Hypothesis Strength",
  riskAwareness: "Risk Awareness",
  historicalValidation: "Historical Validation",
};

export default function IntelligenceScorePanel({ score }: { score: IntelligenceScore }) {
  const [expanded, setExpanded] = useState(false);
  const componentEntries = Object.entries(score.components) as [IntelligenceScoreComponentKey, IntelligenceScore["components"][IntelligenceScoreComponentKey]][];

  return (
    <div className="rounded-card border border-border bg-ink-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center text-xs font-semibold uppercase tracking-[0.14em] text-gold">
          Intelligence Score
          <InfoTooltip
            label="Intelligence Score"
            text="This is an intelligence quality score, NOT a probability of profit or trade success. It measures how complete, consistent, and well-supported the available evidence is."
          />
        </p>
        <span className="font-mono text-lg font-semibold text-gold">
          {score.overallScore !== undefined ? `${score.overallScore}/100` : "Unavailable"}
        </span>
      </div>

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="mt-2 text-xs font-medium text-text-3 underline decoration-dotted underline-offset-2 hover:text-text-2"
      >
        {expanded ? "Hide breakdown" : "Show breakdown"}
      </button>

      {expanded && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {componentEntries.map(([key, component]) => (
            <div key={key} className="rounded-control border border-border bg-ink px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-text-2">{COMPONENT_LABELS[key]}</span>
                <span className="font-mono text-xs text-text">
                  {component.dataAvailable ? `${component.score}/100` : "Unavailable"}
                </span>
              </div>
              {component.basis[0] && <p className="mt-1 text-[11px] leading-4 text-text-3">{component.basis[0]}</p>}
            </div>
          ))}
        </div>
      )}

      {expanded && score.limitations.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-border pt-3">
          {score.limitations.map((line) => (
            <li key={line} className="text-[11px] leading-4 text-text-3">
              {line}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
