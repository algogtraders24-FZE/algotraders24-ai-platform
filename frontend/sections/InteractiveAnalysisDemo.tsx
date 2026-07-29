"use client";

// sections/InteractiveAnalysisDemo.tsx
// Sprint H1.7 - "Interactive AI Analysis Demo (Illustrative)". Distinct
// from Explainable Intelligence (the simplified marketing pipeline) and
// Architecture Visualization (the technical file trace): this is a
// hands-on preview of the actual OUTPUT SHAPE a real analysis produces -
// modeled directly on the real MarketAnalysisResult fields wired to
// production in Sprint L2.1 (components/market-intelligence/
// AnalysisResult.tsx: supporting/opposing evidence, an 8-category risk
// breakdown, a 7-category confidence breakdown). Every value here is
// clearly marked illustrative - no specific price, date, or real market
// claim appears anywhere, matching the same disclosure standard
// AssistantPreview already established for the AI Assistant.
import { useState } from "react";

const STAGES = [
  { key: "evidence", label: "Evidence" },
  { key: "reasoning", label: "Reasoning" },
  { key: "risk", label: "Risk" },
  { key: "confidence", label: "Confidence" },
  { key: "explained", label: "Explained" },
] as const;
type StageKey = (typeof STAGES)[number]["key"];

const RISK_LEVEL_TONE: Record<string, string> = {
  Low: "border-signal-up/30 bg-signal-up/10 text-signal-up",
  Medium: "border-warn/30 bg-warn/10 text-warn",
  High: "border-signal-down/30 bg-signal-down/10 text-signal-down",
};

export default function InteractiveAnalysisDemo() {
  const [stage, setStage] = useState<StageKey>("evidence");

  return (
    <section className="bg-ink py-16 text-text md:py-24">
      <div className="mx-auto max-w-4xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-gold">Interactive Demo</p>
          <h2 className="mt-4 font-display text-4xl font-medium md:text-5xl">See the shape of a real analysis</h2>
          <p className="mt-5 text-lg text-text-2">
            Click through each stage to see exactly what it produces — the same fields a live analysis returns.
          </p>
        </div>

        <div className="mx-auto mt-8 max-w-xl rounded-control border border-gold/30 bg-gold/10 px-4 py-2 text-center text-xs font-medium text-gold">
          Illustrative example — sample content, not a live market analysis
        </div>

        <div className="mt-8 flex flex-wrap justify-center gap-2">
          {STAGES.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setStage(s.key)}
              aria-pressed={stage === s.key}
              className={`rounded-control border px-4 py-2 text-sm font-medium transition-colors ${
                stage === s.key ? "border-gold bg-ink-3 text-text" : "border-border bg-ink-2 text-text-2 hover:border-gold"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="mt-6 rounded-panel border border-border bg-ink-2 p-6 md:p-8">
          {stage === "evidence" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-card border-l-2 border-gold border-y border-r border-border bg-ink p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gold">Supporting (illustrative)</p>
                <ul className="mt-2 space-y-2 text-sm leading-6 text-text-2">
                  <li>Price action is holding above a recent support level.</li>
                  <li>Short-term momentum shows mild upward pressure.</li>
                </ul>
              </div>
              <div className="rounded-card border-l-2 border-signal-down/60 border-y border-r border-border bg-ink p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-signal-down">Opposing (illustrative)</p>
                <ul className="mt-2 space-y-2 text-sm leading-6 text-text-2">
                  <li>Volatility has increased compared to the prior session.</li>
                </ul>
              </div>
            </div>
          )}

          {stage === "reasoning" && (
            <ul className="space-y-3">
              <li className="rounded-card border border-border bg-ink p-4 text-sm leading-6 text-text-2">
                <span className="font-semibold text-text">Supporting: </span>
                Two independent evidence items point the same direction — treated as corroborating, not just repeated.
              </li>
              <li className="rounded-card border border-border bg-ink p-4 text-sm leading-6 text-text-2">
                <span className="font-semibold text-text">Opposing: </span>
                One item conflicts with the majority signal — preserved and shown, never quietly dropped.
              </li>
              <li className="rounded-card border border-border bg-ink p-4 text-sm leading-6 text-text-2">
                <span className="font-semibold text-text">Unresolved: </span>
                When a source has nothing to say, that absence is marked explicitly — never assumed neutral.
              </li>
            </ul>
          )}

          {stage === "risk" && (
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { category: "Market", level: "Medium", note: "Price within a normal historical range (illustrative)." },
                { category: "Volatility", level: "Medium", note: "Recent swings are moderate, not extreme (illustrative)." },
                { category: "Liquidity", level: "Low", note: "No liquidity concerns identified (illustrative)." },
                { category: "Data Quality", level: "Low", note: "Evidence sources agree with each other (illustrative)." },
              ].map((r) => (
                <div key={r.category} className="rounded-card border border-border bg-ink p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-text">{r.category}</span>
                    <span className={`inline-block rounded-control border px-2 py-0.5 text-xs font-semibold ${RISK_LEVEL_TONE[r.level]}`}>
                      {r.level}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-text-3">{r.note}</p>
                </div>
              ))}
              <p className="sm:col-span-2 text-xs text-text-3">
                A real analysis assesses all eight categories, every time — this shows four as an example.
              </p>
            </div>
          )}

          {stage === "confidence" && (
            <div className="space-y-3">
              {[
                { category: "Evidence Quality", score: 72 },
                { category: "Evidence Agreement", score: 65 },
                { category: "Source Diversity", score: 40 },
              ].map((c) => (
                <div key={c.category}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-text-2">{c.category}</span>
                    <span className="font-mono text-text-3">{c.score}/100 (illustrative)</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-3">
                    <div className="h-full rounded-full bg-gold" style={{ width: `${c.score}%` }} />
                  </div>
                </div>
              ))}
              <p className="pt-2 text-xs text-text-3">
                A real analysis scores seven categories this way, then reports the overall level plainly — never a
                single confident-sounding number with nothing behind it.
              </p>
            </div>
          )}

          {stage === "explained" && (
            <p className="text-sm leading-7 text-text-2">
              This is what a finished explanation reads like: a plain-language synthesis of everything above — what
              supports the thesis, what opposes it, what remains unknown, and exactly how confident the system is
              and why. On a real run, every sentence traces back to a specific piece of evidence — nothing here is
              invented to sound complete.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
