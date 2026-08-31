// app/quant-lite/page.tsx
// Sprint Q0.8 - Quant Lite Home (Screen 1,
// quant-engine/reports/Q0.7_UI_INFORMATION_ARCHITECTURE.md). Self-composed
// Navbar/Footer, matching the existing app/pricing, app/products pattern
// (no shared marketing layout.tsx exists to hook into instead).
//
// Sprint Q1.6 Part 3 - expanded from the Q0.8 baseline (hero + assumptions
// only) to explicitly cover what the sprint brief calls out: WHAT IT DOES,
// the 5-step HOW IT WORKS flow, and the FREE FEATURES list - all real,
// nothing invented (the feature list mirrors SUPPORTED_INDICATOR_TYPES and
// SUPPORTED_CODEGEN_LANGUAGES, the actual product ceiling, not marketing
// copy). Also adds an explicit "not Quant Pro" line (Part 4/12) - this
// page and /quant-lite/upgrade are now the two places that boundary is
// stated, worded consistently with each other.
import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import ButtonLink from "@/components/ui/ButtonLink";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import ExecutionAssumptionsPanel from "@/components/quant-lite/ExecutionAssumptionsPanel";

export const metadata: Metadata = {
  title: "Quant Lite",
  description:
    "Build and backtest trading strategies with transparent execution assumptions. Free, deterministic, and honest about what it does and does not model.",
  alternates: { canonical: "/quant-lite" },
};

const HOW_IT_WORKS = [
  { step: 1, title: "Build Strategy", description: "Pick indicators, set BUY/SELL conditions, and define stop-loss/take-profit rules." },
  { step: 2, title: "Select Market & Data", description: "Choose a supported symbol, timeframe, and date range - real coverage is checked before you run." },
  { step: 3, title: "Backtest", description: "Runs on the canonical, deterministic execution engine against real historical data." },
  { step: 4, title: "Inspect Evidence", description: "Review metrics, equity curve, the full trade ledger, and the exact assumptions behind the result." },
  { step: 5, title: "Generate Code", description: "Export the same strategy as MT4, MT5, or Pine Script - reviewed and tested before live use." },
] as const;

const FREE_FEATURES = [
  "Strategy Builder",
  "10 supported indicators",
  "Historical backtesting",
  "Core performance metrics",
  "Equity curve",
  "Trade ledger",
  "Data coverage information",
  "Execution assumptions panel",
  "Strategy library",
  "MT4 code generation",
  "MT5 code generation",
  "Pine Script code generation",
] as const;

export default function QuantLiteHomePage() {
  return (
    <main className="min-h-screen bg-ink pt-20 text-text">
      <Navbar />

      <section className="mx-auto max-w-4xl px-6 py-16 text-center">
        <div className="flex items-center justify-center gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-gold">AT24 Quant Lite</p>
          <Badge tone="success">Free</Badge>
        </div>
        <h1 className="mt-3 text-4xl font-semibold text-text sm:text-5xl">
          Build and backtest trading strategies with transparent execution assumptions.
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-base text-text-2">
          Create a rule-based trading strategy from supported indicators, backtest it against real historical
          data on one canonical, deterministic execution engine, inspect the full evidence behind the result,
          and generate platform code. No hidden execution model, no fabricated metrics.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <ButtonLink href="/quant-lite/builder" size="lg">
            Try Quant Lite — Free
          </ButtonLink>
          <ButtonLink href="/quant-lite/library" variant="secondary" size="lg">
            Explore Strategy Library
          </ButtonLink>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-4 text-sm">
          <Link href="#how-it-works" className="text-text-2 underline decoration-border underline-offset-4 hover:text-gold">
            See how it works
          </Link>
          <Link href="/quant-lite/upgrade" className="text-text-2 underline decoration-border underline-offset-4 hover:text-gold">
            Explore Quant Pro
          </Link>
        </div>
      </section>

      <section id="how-it-works" className="mx-auto max-w-5xl px-6 pb-16">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-gold">How It Works</p>
          <h2 className="mt-2 text-2xl font-semibold text-text">Five steps, start to finish</h2>
        </div>
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-5">
          {HOW_IT_WORKS.map((s) => (
            <Card key={s.step} padding="sm" className="text-left">
              <span className="flex h-7 w-7 items-center justify-center rounded-control border border-gold/30 bg-gold/10 text-xs font-semibold text-gold">
                {s.step}
              </span>
              <p className="mt-3 text-sm font-semibold text-text">{s.title}</p>
              <p className="mt-1 text-xs text-text-3">{s.description}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-16">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-gold">Free Features</p>
          <h2 className="mt-2 text-2xl font-semibold text-text">Everything below is included, free</h2>
        </div>
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {FREE_FEATURES.map((f) => (
            <div key={f} className="flex items-center gap-2 rounded-control border border-border bg-ink-2 px-3 py-2.5 text-sm text-text-2">
              <span className="text-gold">&bull;</span>
              {f}
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-6 pb-20">
        <Card padding="lg">
          <h2 className="text-lg font-semibold text-text">What this tool does and does not model</h2>
          <p className="mt-1 text-sm text-text-3">
            Backtest results are historical simulation results and are not a guarantee of future performance.
            Results depend on the declared execution assumptions below and on the historical data actually
            available for a given symbol/timeframe/date range - coverage restrictions are real and are shown
            on every backtest, never hidden.
          </p>
          <div className="mt-6">
            <ExecutionAssumptionsPanel />
          </div>
          <p className="mt-4 text-xs text-text-3">
            Quant Lite is a free, simpler, deterministic research and educational tool - it is not Quant Pro,
            not institutional research, does not model tick-level execution, and does not guarantee
            profitability or broker-verified performance.{" "}
            <Link href="/quant-lite/upgrade" className="underline decoration-border underline-offset-4 hover:text-gold">
              See how it compares to Quant Pro
            </Link>
            .
          </p>
        </Card>
      </section>

      <Footer />
    </main>
  );
}
