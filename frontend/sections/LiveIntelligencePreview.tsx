// sections/LiveIntelligencePreview.tsx
// Sprint D2.4.A1 - "Live Market Intelligence Preview," per the user's
// explicit instruction: real cached data OR an honestly labeled demo state,
// never fabricated market data. A genuinely live public preview would need
// a new UNAUTHENTICATED API route (today's market-data routes are all
// under /api/private/*, session-gated) - that's a real backend/security
// decision (what to expose publicly, rate limiting) outside this IA
// sprint's stated "no backend changes" boundary, not something to rush in
// silently. This ships the demo-state option instead, reusing the exact
// "Illustrative example" disclosure pattern already established twice in
// this codebase (sections/AssistantPreview.tsx, sections/
// InteractiveAnalysisDemo.tsx) - same honesty standard, same visual
// language, so it reads as one consistent site, not a bolted-on widget.
import Link from "next/link";

const SNAPSHOT = {
  symbol: "EURUSD",
  price: "1.08540",
  changePercent: "+0.13%",
  risk: { level: "High", tone: "border-signal-down/30 bg-signal-down/10 text-signal-down" },
  confidence: { level: "Low", score: 20, tone: "border-signal-down/30 bg-signal-down/10 text-signal-down" },
  note: "Reported honestly because most evidence types weren't available for this run — the pipeline never rounds up to sound more certain than the evidence supports.",
};

export default function LiveIntelligencePreview() {
  return (
    <section className="bg-ink-2 py-16 text-text md:py-24">
      <div className="mx-auto max-w-4xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-gold">AI Intelligence</p>
          <h2 className="mt-4 font-display text-4xl font-medium md:text-5xl">What a real analysis looks like</h2>
          <p className="mt-5 text-lg text-text-2">
            Not a fabricated number — this is the same shape (and the same honesty) a live run returns.
          </p>
        </div>

        <div className="mx-auto mt-8 max-w-xl rounded-control border border-gold/30 bg-gold/10 px-4 py-2 text-center text-xs font-medium text-gold">
          Illustrative example — modeled on a real prior run, not a live market analysis
        </div>

        <div className="mt-10 overflow-hidden rounded-panel border border-border bg-ink shadow-raised">
          <div className="flex items-center gap-3 border-b border-border px-5 py-3">
            <span className="text-sm font-semibold text-text">{SNAPSHOT.symbol}</span>
            <span className="font-mono text-sm text-text-2">
              {SNAPSHOT.price} <span className="text-signal-up">{SNAPSHOT.changePercent}</span>
            </span>
            <span className="ml-auto rounded-control border border-gold/30 bg-gold/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gold">
              Illustrative
            </span>
          </div>
          <div className="grid gap-4 p-6 sm:grid-cols-2">
            <div className="rounded-card border border-border bg-ink-2 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-text-3">Risk</p>
              <span className={`mt-2 inline-block rounded-control border px-3 py-1 text-sm font-semibold ${SNAPSHOT.risk.tone}`}>
                {SNAPSHOT.risk.level}
              </span>
            </div>
            <div className="rounded-card border border-border bg-ink-2 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-text-3">AI Confidence</p>
              <div className="mt-2 flex items-baseline gap-2">
                <span className={`inline-block rounded-control border px-3 py-1 text-sm font-semibold ${SNAPSHOT.confidence.tone}`}>
                  {SNAPSHOT.confidence.level}
                </span>
                <span className="font-mono text-sm text-text-3">{SNAPSHOT.confidence.score}/100</span>
              </div>
            </div>
          </div>
          <p className="border-t border-border px-6 py-4 text-sm leading-6 text-text-2">{SNAPSHOT.note}</p>
        </div>

        <div className="mt-8 text-center">
          <Link href="/platform/market-intelligence" className="text-sm font-semibold text-gold transition-colors hover:text-gold-strong">
            See the full pipeline →
          </Link>
        </div>
      </div>
    </section>
  );
}
