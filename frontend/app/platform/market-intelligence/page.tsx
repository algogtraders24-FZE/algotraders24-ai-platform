// app/platform/market-intelligence/page.tsx
// Sprint D2.4.A1 - assembled from sections/ExplainableIntelligence.tsx's
// 5-stage flow + 7-service technical trace and sections/InteractiveAnalysisDemo.tsx's
// description, per the approved D2.4.A1 IA plan.
//
// Sprint D2.4.A2 - homepage compression moved the actual interactive demo
// component here (it now embeds <InteractiveAnalysisDemo /> for real,
// replacing the old "the Workspace's interactive demo..." placeholder text
// that pointed at content that, at the time, only existed on the homepage).
// ExplainableIntelligence's homepage copy is now a static teaser (see
// sections/ExplainableIntelligence.tsx) - this page still carries the full
// 5-stage + 7-service depth.
import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import PageHero from "@/components/marketing/PageHero";
import PlatformCTA from "@/components/marketing/PlatformCTA";
import InteractiveAnalysisDemo from "@/sections/InteractiveAnalysisDemo";

export const metadata: Metadata = {
  title: "Market Intelligence",
  description: "Evidence, reasoning, risk, and confidence, run through a deterministic pipeline in full view — nothing invented, nothing hidden.",
  alternates: { canonical: "/platform/market-intelligence" },
};

const STAGES = [
  { title: "Evidence", description: "Price and news evidence collected from real, attributed sources — fused and deduplicated before anything else happens." },
  { title: "Reasoning", description: "Every item is classified as supporting, opposing, or unresolved — disagreement is surfaced, never smoothed over." },
  { title: "Risk", description: "Assessed across eight distinct categories — market, event, liquidity, volatility, execution, evidence conflict, data quality, and uncertainty." },
  { title: "Confidence", description: "Scored from how much real evidence exists and how well it agrees — never a number invented to sound authoritative." },
  { title: "Explainable Analysis", description: "Presented in plain language — the evidence, the reasoning, the limitations, all visible, nothing hidden behind a single verdict." },
] as const;

const TECH_STAGES = [
  { file: "lib/market-data/providers/alpha-vantage.provider.ts", title: "Market data ingestion", description: "Real-time price and news data pulled from external providers, normalized into a common evidence shape." },
  { file: "services/ai/evidence-fusion.service.ts", title: "Evidence fusion", description: "Evidence from every source is deduplicated and merged before ranking ever begins." },
  { file: "services/ai/evidence/evidence-ranking.service.ts", title: "Evidence ranking", description: "Remaining evidence is scored and ordered by relevance and source reliability." },
  { file: "services/ai/reasoning/reasoning-engine.service.ts", title: "Reasoning", description: "Each item is classified as supporting, opposing, or unresolved — disagreement is surfaced, not smoothed over." },
  { file: "services/ai/risk/risk-engine.service.ts", title: "Risk assessment", description: "Assessed across eight distinct categories, every time — never collapsed into one score." },
  { file: "services/ai/confidence/confidence-engine.service.ts", title: "Confidence scoring", description: "Scored from how much real evidence exists and how well it agrees, not invented to sound authoritative." },
  { file: "services/ai/explainable/explainable-analysis.service.ts", title: "Explainable output", description: "Everything above is composed into one transparent, human-readable analysis — nothing hidden behind a verdict." },
] as const;

export default function MarketIntelligencePlatformPage() {
  return (
    <main className="min-h-screen bg-ink text-text">
      <Navbar />
      <PageHero
        eyebrow="Platform / Market Intelligence"
        title="Explainable Intelligence"
        subtitle="The same deterministic process behind every analysis — nothing invented, nothing hidden."
      />

      <section className="px-6 py-12">
        <ol className="mx-auto grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {STAGES.map((stage, index) => (
            <li key={stage.title} className="rounded-card border border-gold bg-ink-3 p-6">
              <span className="font-mono text-xs text-gold-strong">0{index + 1}</span>
              <h2 className="mt-2 text-lg font-semibold">{stage.title}</h2>
              <p className="mt-2 text-sm leading-6 text-text-2">{stage.description}</p>
            </li>
          ))}
        </ol>
      </section>

      <InteractiveAnalysisDemo />

      <section className="px-6 py-8">
        <div className="mx-auto max-w-3xl">
          <p className="text-center text-sm font-semibold uppercase tracking-[0.14em] text-gold">
            For technical evaluators — the exact seven services, in order
          </p>
          <ol className="mt-6 space-y-4">
            {TECH_STAGES.map((stage, index) => (
              <li key={stage.file} className="flex gap-4 rounded-card border border-border bg-ink-2 p-4">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-gold/40 bg-gold/10 font-mono text-[10px] text-gold-strong">
                  {index + 1}
                </span>
                <div>
                  <p className="font-mono text-xs text-text-3">{stage.file}</p>
                  <p className="mt-0.5 text-sm font-semibold text-text">{stage.title}</p>
                  <p className="mt-0.5 text-sm leading-6 text-text-2">{stage.description}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <p className="mx-auto max-w-3xl px-6 text-center text-sm text-text-3">
        Shares its evidence layer with the{" "}
        <Link href="/platform/assistant" className="text-gold hover:text-gold-strong">
          AI Assistant
        </Link>{" "}
        and{" "}
        <Link href="/platform/knowledge-base" className="text-gold hover:text-gold-strong">
          Knowledge Base
        </Link>
        .
      </p>

      <PlatformCTA dashboardHref="/dashboard/market-intelligence" dashboardLabel="Open Market Intelligence" />
      <Footer />
    </main>
  );
}
