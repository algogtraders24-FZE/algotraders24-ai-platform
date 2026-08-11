"use client";
// components/intelligence-workspace/VerifiedAIAnswerCard.tsx
// Sprint D2.6.10 - Trader Intelligence Workspace & Verified Answer
// Experience. The primary trader-facing card for one presented, verified
// answer. Every section below only ever renders when real intelligence
// backs it - an insufficient-intelligence result shows exactly that,
// with the real missing-information list, never generic filler text.
// LLMs are presenters only: the "Presented by" line always makes that
// boundary explicit, never implying a specific model calculated the
// underlying market intelligence.
import { useState, type ReactNode } from "react";
import type { VerifiedAnswerResponse } from "@/types/verified-answer-response";
import Badge from "@/components/ui/Badge";
import Disclaimer from "@/components/ui/Disclaimer";
import VerifiedMarketContext from "./VerifiedMarketContext";
import EvidencePanel from "./EvidencePanel";
import HypothesisPanel from "./HypothesisPanel";
import IntelligenceScorePanel from "./IntelligenceScorePanel";
import MarketDataProvenance from "./MarketDataProvenance";
import AuditTraceView from "./AuditTraceView";
import { formatLabel, RISK_LEVEL_TONE } from "./format";

function RiskSection({ risk }: { risk: VerifiedAnswerResponse["riskContext"] }) {
  if (!risk.dataAvailable) {
    return <p className="text-sm text-text-3">No risk information was available for this analysis.</p>;
  }
  return (
    <div className="space-y-2">
      {risk.overallLevel && (
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-text-3">Overall</span>
          <Badge tone={RISK_LEVEL_TONE[risk.overallLevel]}>{risk.overallLevel}</Badge>
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {risk.categories.map((c) => (
          <div key={c.category} className="rounded-control border border-border bg-ink px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-text-2">{formatLabel(c.category)}</span>
              <Badge tone={RISK_LEVEL_TONE[c.level]}>{c.level}</Badge>
            </div>
            {c.rationale[0] && <p className="mt-1 text-[11px] leading-4 text-text-3">{c.rationale[0]}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

function MissingInformationSection({ items }: { items: VerifiedAnswerResponse["missingInformation"] }) {
  if (items.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li key={`${item.affectedArea}-${item.description}`} className="text-sm leading-6 text-text-2">
          {item.description}
        </li>
      ))}
    </ul>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-gold">{title}</h3>
      <div className="mt-2">{children}</div>
    </div>
  );
}

export default function VerifiedAIAnswerCard({ result }: { result: VerifiedAnswerResponse }) {
  const [showWhy, setShowWhy] = useState(false);
  const [showTrace, setShowTrace] = useState(false);

  const insufficient = result.decisionState === "insufficient-intelligence";

  return (
    <div className="space-y-4 rounded-panel border border-border bg-ink p-5">
      <VerifiedMarketContext result={result} />

      <p className="text-base leading-7 text-text">{result.answer}</p>

      {insufficient ? (
        <div className="rounded-card border border-dashed border-border bg-ink-2 p-4">
          <p className="text-sm font-semibold text-text">Insufficient intelligence</p>
          <p className="mt-1 text-sm leading-6 text-text-2">
            There is not enough verified intelligence available right now to provide a well-supported analysis.
          </p>
          <MissingInformationSection items={result.missingInformation} />
        </div>
      ) : (
        <>
          {(result.supportingEvidence.length > 0 || result.opposingEvidence.length > 0) && (
            <Section title="Why">
              <EvidencePanel
                supportingEvidence={result.supportingEvidence}
                opposingEvidence={result.opposingEvidence}
                unresolvedConflicts={result.unresolvedConflicts}
              />
            </Section>
          )}

          {result.hypotheses.length > 0 && (
            <Section title="What Could Happen">
              <HypothesisPanel hypotheses={result.hypotheses} invalidationConditions={result.invalidationConditions} />
            </Section>
          )}

          {result.riskContext.dataAvailable && (
            <Section title="Risks">
              <RiskSection risk={result.riskContext} />
            </Section>
          )}

          {result.missingInformation.length > 0 && (
            <Section title="What Is Missing">
              <MissingInformationSection items={result.missingInformation} />
            </Section>
          )}
        </>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-3 text-xs">
        <span className="text-text-3">
          Presented by <span className="text-text-2">{formatLabel(result.presentedBy)}</span> — explains verified
          intelligence, does not generate it.
        </span>
        <button type="button" onClick={() => setShowWhy((v) => !v)} className="text-gold underline decoration-dotted underline-offset-2 hover:text-gold-strong">
          {showWhy ? "Hide why this answer" : "Why this answer?"}
        </button>
        {result.auditTraceId && (
          <button type="button" onClick={() => setShowTrace((v) => !v)} className="text-gold underline decoration-dotted underline-offset-2 hover:text-gold-strong">
            {showTrace ? "Hide analysis trace" : "View analysis trace"}
          </button>
        )}
      </div>

      {showWhy && (
        <div className="space-y-4 rounded-card border border-border bg-ink-2 p-4">
          <Section title="Data Used">
            <MarketDataProvenance result={result} />
          </Section>
          <Section title="Intelligence Score">
            <IntelligenceScorePanel score={result.intelligenceScore} />
          </Section>
          {result.historicalContext.status === "available" && (
            <Section title="Historical Validation">
              <p className="text-sm text-text-2">
                {result.historicalContext.validatedCount}/{result.historicalContext.sampleSize} historical
                hypotheses validated ({result.historicalContext.validatedRate !== undefined ? `${Math.round(result.historicalContext.validatedRate * 100)}%` : "rate unavailable"}).
              </p>
            </Section>
          )}
          {result.historicalContext.status !== "available" && (
            <Section title="Historical Validation">
              <p className="text-sm text-text-3">{result.historicalContext.basis[0] ?? "Not available."}</p>
            </Section>
          )}
        </div>
      )}

      {showTrace && result.auditTraceId && <AuditTraceView traceId={result.auditTraceId} />}

      <Disclaimer />
    </div>
  );
}
