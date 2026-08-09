"use client";

// components/hero/HeroDashboardPreview.tsx
// Sprint D2.4.A5 - Visual Identity & Product Showcase. The Hero's static
// single-panel preview is replaced with a layered composition: the real
// EUR/USD market-intelligence.png screenshot (the same unedited capture
// used on /platform/workspace since D2.1 - genuinely reports High risk /
// Low confidence, nothing staged) as the centerpiece, with two small
// floating proof cards overlapping its corners - the existing
// PipelineProofPanel (unchanged, just repositioned/shrunk) and a new
// compact "AI Confidence" widget that reuses the exact same real-shape
// EURUSD numbers already established and reused across the site
// (sections/LiveIntelligencePreview's old snapshot, /platform/workspace's
// callouts) rather than inventing new ones.
//
// No new screenshots were captured for this: there's no Supabase
// service-role key configured locally and signup requires email
// verification this environment can't complete, so only the two screenshots
// that already existed (assistant.png, market-intelligence.png) were
// available to build with. Floating cards are hidden below `lg` - absolute-
// positioned overlays over a screenshot don't have room to breathe on a
// phone-width viewport, so mobile gets the plain, unobstructed screenshot.
import Image from "next/image";
import Link from "next/link";
import PipelineProofPanel from "./PipelineProofPanel";

const CONFIDENCE_WIDGET = {
  symbol: "EURUSD",
  risk: { level: "High", tone: "border-signal-down/30 bg-signal-down/10 text-signal-down" },
  confidence: { level: "Low", score: 20, tone: "border-signal-down/30 bg-signal-down/10 text-signal-down" },
};

export default function HeroDashboardPreview() {
  return (
    <div className="relative mx-auto w-full max-w-lg">
      {/* Centerpiece: the real, unedited Market Intelligence screenshot */}
      <div className="overflow-hidden rounded-panel border border-border bg-ink-2/70 shadow-raised backdrop-blur">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <span aria-hidden="true" className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-steel/40" />
            <span className="h-2.5 w-2.5 rounded-full bg-steel/40" />
            <span className="h-2.5 w-2.5 rounded-full bg-gold/50" />
          </span>
          <span className="text-xs font-medium text-text-2">Market Intelligence</span>
          <span className="ml-auto rounded-control border border-gold/30 bg-gold/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gold">
            Live screenshot
          </span>
        </div>
        <Image
          src="/showcase/market-intelligence.png"
          alt="A real EUR/USD analysis: overall risk High, confidence Low (20/100), with supporting evidence and an eight-category risk breakdown."
          width={1440}
          height={1010}
          className="h-auto w-full"
          sizes="(max-width: 1024px) 100vw, 32rem"
          priority
        />
      </div>

      {/* Floating card: the deterministic pipeline (existing component, repositioned) */}
      <div
        className="animate-float-drift absolute -left-10 -bottom-10 hidden w-64 rounded-panel border border-border bg-ink-2 p-5 shadow-floating lg:block"
        style={{ animationDelay: "0s" }}
      >
        <PipelineProofPanel compact />
      </div>

      {/* Floating card: AI Confidence widget - same real-shape numbers used elsewhere on the site */}
      <div
        className="animate-float-drift absolute -right-8 -top-8 hidden w-56 rounded-panel border border-border bg-ink-2 p-4 shadow-floating lg:block"
        style={{ animationDelay: "1.8s" }}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-text-2">{CONFIDENCE_WIDGET.symbol}</span>
          <span className="rounded-control border border-gold/30 bg-gold/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-gold">
            Illustrative
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-3">Risk</p>
            <span className={`mt-1 inline-block rounded-control border px-2 py-0.5 text-xs font-semibold ${CONFIDENCE_WIDGET.risk.tone}`}>
              {CONFIDENCE_WIDGET.risk.level}
            </span>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-3">Confidence</p>
            <span className={`mt-1 inline-block rounded-control border px-2 py-0.5 text-xs font-semibold ${CONFIDENCE_WIDGET.confidence.tone}`}>
              {CONFIDENCE_WIDGET.confidence.level}
            </span>
          </div>
        </div>
        <Link
          href="/platform/market-intelligence"
          className="mt-3 block text-center text-xs font-semibold text-gold transition-colors hover:text-gold-strong"
        >
          See the full pipeline →
        </Link>
      </div>
    </div>
  );
}
