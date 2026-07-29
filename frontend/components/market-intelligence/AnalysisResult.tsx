// components/market-intelligence/AnalysisResult.tsx
// Sprint L2.1 - Renders one real MarketAnalysisResult from the Sprint 15D
// pipeline: Gemini's natural-language summary first (what the user reads),
// then the full deterministic breakdown underneath (what it's grounded
// in) - evidence, risk, and confidence, category by category, exactly as
// the engines computed them. Nothing here is decorative: every section
// maps to a real field on the result, and an empty list renders as an
// explicit "None available" rather than being hidden.
import type { MarketAnalysisResult } from "@/types/market-analysis-orchestration";
import type { ExplanationLine } from "@/types/explainable-analysis";
import type { RiskLevel } from "@/types/risk";
import type { ConfidenceLevel } from "@/types/confidence-intelligence";

function formatLabel(value: string): string {
  return value.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const GOOD_TONE = "border-signal-up/30 bg-signal-up/10 text-signal-up";
const MID_TONE = "border-warn/30 bg-warn/10 text-warn";
const BAD_TONE = "border-signal-down/30 bg-signal-down/10 text-signal-down";

// Risk: high is bad. Confidence: high is good - the two levels are inverses
// of each other, so each gets its own explicit map rather than sharing one.
const RISK_TONE: Record<RiskLevel, string> = { low: GOOD_TONE, medium: MID_TONE, high: BAD_TONE };
const CONFIDENCE_TONE: Record<ConfidenceLevel, string> = { high: GOOD_TONE, medium: MID_TONE, low: BAD_TONE };
function confidenceScoreTone(score: number): string {
  return score >= 66 ? GOOD_TONE : score >= 33 ? MID_TONE : BAD_TONE;
}

function LevelCard({
  title,
  level,
  score,
}: {
  title: string;
  level: RiskLevel | ConfidenceLevel;
  score?: number;
}) {
  const tone = title === "Risk" ? RISK_TONE[level as RiskLevel] : CONFIDENCE_TONE[level as ConfidenceLevel];
  return (
    <div className="rounded-card border border-border bg-ink-2 p-6">
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-text-3">{title}</p>
      <div className="mt-3 flex items-baseline gap-3">
        <span className={`inline-block rounded-control border px-3 py-1 text-sm font-semibold capitalize ${tone}`}>
          {level}
        </span>
        {score !== undefined && <span className="font-mono text-sm text-text-2">{score}/100</span>}
      </div>
    </div>
  );
}

function Section({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-gold">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-text-2">{text}</p>
    </div>
  );
}

function EvidenceColumn({
  title,
  lines,
  tone,
}: {
  title: string;
  lines: ExplanationLine[];
  tone: "gold" | "down";
}) {
  const border = tone === "gold" ? "border-gold" : "border-signal-down/60";
  const label = tone === "gold" ? "text-gold" : "text-signal-down";
  return (
    <div className={`rounded-card border-l-2 ${border} border-y border-r border-border bg-ink-2 p-5`}>
      <p className={`text-xs font-semibold uppercase tracking-[0.14em] ${label}`}>{title}</p>
      {lines.length === 0 ? (
        <p className="mt-2 text-sm text-text-3">None available.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {lines.map((line) => (
            <li key={line.text} className="text-sm leading-6 text-text-2">
              {line.text}
              {line.basis.length > 0 && (
                <span className="ml-1 font-mono text-xs text-text-3">
                  — {line.basis.map((b) => b.source).join(", ")}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CategoryGrid({
  title,
  items,
}: {
  title: string;
  items: { label: string; badge: string; rationale: string[]; tone: string }[];
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-gold">{title}</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <div key={item.label} className="rounded-card border border-border bg-ink-2 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-text">{formatLabel(item.label)}</span>
              <span className={`inline-block rounded-control border px-2 py-0.5 text-xs font-semibold capitalize ${item.tone}`}>
                {item.badge}
              </span>
            </div>
            <ul className="mt-2 space-y-1">
              {item.rationale.map((line) => (
                <li key={line} className="text-xs leading-5 text-text-3">
                  {line}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function ListSection({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-text-3">{title}</h3>
      <ul className="mt-2 space-y-1.5">
        {items.map((item) => (
          <li key={item} className="text-sm leading-6 text-text-2">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function AnalysisResult({ result }: { result: MarketAnalysisResult }) {
  const { explainable, risk, confidence, summary } = result;

  return (
    <div className="space-y-8">
      <div className="rounded-panel border border-border bg-ink-2 p-6">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-gold">AI Summary</p>
        <p className="mt-3 text-base leading-7 text-text">{summary}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <LevelCard title="Risk" level={risk.overallLevel} />
        <LevelCard title="Confidence" level={confidence.overallLevel} score={confidence.overallScore} />
      </div>

      <Section title="Executive Summary" text={explainable.executiveSummary} />
      <Section title="Market Thesis" text={explainable.marketThesis} />

      <div className="grid gap-4 sm:grid-cols-2">
        <EvidenceColumn title="Supporting Evidence" lines={explainable.supportingEvidence} tone="gold" />
        <EvidenceColumn title="Opposing Evidence" lines={explainable.opposingEvidence} tone="down" />
      </div>

      <CategoryGrid
        title="Risk Breakdown"
        items={risk.categories.map((c) => ({
          label: c.category,
          badge: c.level,
          rationale: c.rationale,
          tone: RISK_TONE[c.level],
        }))}
      />

      <CategoryGrid
        title="Confidence Breakdown"
        items={confidence.categories.map((c) => ({
          label: c.category,
          badge: `${c.score}/100`,
          rationale: c.rationale,
          tone: confidenceScoreTone(c.score),
        }))}
      />

      <div className="grid gap-6 sm:grid-cols-3">
        <ListSection title="Assumptions" items={explainable.assumptions} />
        <ListSection title="Limitations" items={explainable.limitations} />
        <ListSection title="Unknown Factors" items={explainable.unknownFactors} />
      </div>

      <Section title="Recommendation Basis" text={explainable.recommendationBasis} />

      <p className="border-t border-border pt-4 font-mono text-xs text-text-3">
        Pipeline {explainable.metadata.sourcePipelineVersion} · Generated{" "}
        {new Date(explainable.metadata.generatedAt).toLocaleString()}
      </p>
    </div>
  );
}
