// sections/ExplainableIntelligence.tsx
// Sprint H1.4 Phase 4 - the platform's signature section. Five stages,
// matching the real, deterministic architecture exactly (types/evidence.ts,
// reasoning.ts, risk-intelligence.ts, confidence-intelligence.ts,
// explainable-analysis.ts) - no invented AI graphics.
//
// Sprint D2.4.A2 - homepage compression. The scroll-triggered 5-card reveal
// animation and the "seven services" technical collapsible are both dropped
// here, not deleted: /platform/market-intelligence carries the exact same
// 5-stage descriptions plus the full 7-service technical trace, in full
// depth, un-animated so it reads immediately for the evaluator who lands
// there. This homepage copy is now a static one-line-per-stage teaser
// pointing at that page. Server Component: no interactivity needed anymore.
import Link from "next/link";

const STAGES = ["Evidence", "Reasoning", "Risk", "Confidence", "Explained"] as const;

export default function ExplainableIntelligence() {
  return (
    <section className="bg-ink py-16 text-text md:py-24">
      <div className="mx-auto max-w-4xl px-6 text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-gold">The Platform&apos;s Signature</p>
        <h2 className="mt-4 font-display text-4xl font-medium md:text-5xl">Explainable Intelligence</h2>
        <p className="mt-5 text-lg text-text-2">The same deterministic process behind every analysis — nothing invented, nothing hidden.</p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          {STAGES.map((stage, index) => (
            <span key={stage} className="flex items-center gap-3">
              <span className="rounded-control border border-gold/30 bg-gold/10 px-4 py-2 text-sm font-medium text-text">
                {stage}
              </span>
              {index < STAGES.length - 1 && <span className="text-text-3">→</span>}
            </span>
          ))}
        </div>

        <div className="mt-8">
          <Link href="/platform/market-intelligence" className="text-sm font-semibold text-gold transition-colors hover:text-gold-strong">
            See the full pipeline →
          </Link>
        </div>
      </div>
    </section>
  );
}
