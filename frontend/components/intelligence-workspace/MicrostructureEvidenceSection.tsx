// components/intelligence-workspace/MicrostructureEvidenceSection.tsx
// Sprint D2.8.13 - Microstructure Evidence Production Wiring & Decision UI.
// A pure presentation component over D2.8.11's own MicrostructureEvidenceAssessment
// (as now carried by VerifiedAnswerResponse.microstructureEvidence, D2.8.13) -
// computes nothing, matches MicrostructurePanel.tsx's (D2.8.10/D2.8.12) own
// "read the assessment verbatim" discipline. Renders in BOTH real production
// surfaces that consume VerifiedAnswerResponse: the chat "Why this answer?"
// card and the Workspace Research panel (WorkspaceResearch.tsx) - the exact
// same contract, the exact same evidence, never a second interpretation.
import type { MicrostructureEvidenceAssessment, MicrostructureEvidenceStatus } from "@/types/microstructure-evidence-assessment";
import Badge from "@/components/ui/Badge";
import type { BadgeTone } from "@/components/ui/Badge";

const STATUS_LABEL: Record<MicrostructureEvidenceStatus, string> = {
  confirms: "Confirms",
  contradicts: "Contradicts",
  neutral: "Neutral",
  insufficient_evidence: "Insufficient Evidence",
};

const STATUS_TONE: Record<MicrostructureEvidenceStatus, BadgeTone> = {
  confirms: "success",
  contradicts: "danger",
  neutral: "neutral",
  insufficient_evidence: "neutral",
};

export default function MicrostructureEvidenceSection({ evidence }: { evidence: MicrostructureEvidenceAssessment }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {evidence.hypothesisDirection && evidence.hypothesisDirection !== "neutral" && (
          <span className="text-xs uppercase tracking-wider text-text-3">vs. {evidence.hypothesisDirection} hypothesis</span>
        )}
        <Badge tone={STATUS_TONE[evidence.status]}>{STATUS_LABEL[evidence.status]}</Badge>
      </div>

      {evidence.status === "insufficient_evidence" ? (
        <p className="text-sm leading-6 text-text-2">
          Microstructure evidence is insufficient to influence the current hypothesis. No directional confirmation is assigned.
        </p>
      ) : evidence.status === "contradicts" ? (
        <p className="text-sm leading-6 text-text-2">Current order-flow pressure opposes the hypothesis.</p>
      ) : evidence.status === "neutral" ? (
        <p className="text-sm leading-6 text-text-2">
          Microstructure evidence is currently balanced - it neither confirms nor contradicts the hypothesis.
        </p>
      ) : (
        <ul className="space-y-1">
          {evidence.basis.map((line, i) => (
            <li key={i} className="text-sm leading-6 text-text-2">
              {line}
            </li>
          ))}
        </ul>
      )}

      {evidence.provider && (
        <p className="text-xs text-text-3">
          Source: {evidence.provider}
          {evidence.instrument ? ` · ${evidence.instrument}` : ""}
          {evidence.freshness ? ` · ${evidence.freshness}` : ""} — {evidence.provider} venue evidence, not global market
          liquidity.
        </p>
      )}
    </div>
  );
}
