// app/quant-lite/library/[id]/page.tsx
// Sprint Q0.8 - Strategy Detail (Screen 7). Static server component over
// the read-only sample data (matches app/products/[slug]/page.tsx's
// generateStaticParams pattern).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import Card from "@/components/ui/Card";
import ButtonLink from "@/components/ui/ButtonLink";
import LegacyEvidenceBadge from "@/components/quant-lite/LegacyEvidenceBadge";
import MetricTile from "@/components/quant-lite/MetricTile";
import StrategyRuleSummary from "@/components/quant-lite/StrategyRuleSummary";
import ExecutionAssumptionsPanel from "@/components/quant-lite/ExecutionAssumptionsPanel";
import { LIBRARY_SAMPLE } from "@/data/quant-lite-library-sample";

export async function generateStaticParams() {
  return LIBRARY_SAMPLE.map((entry) => ({ id: entry.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const entry = LIBRARY_SAMPLE.find((e) => e.id === id);
  return { title: entry ? `${entry.triggerKey.replace(/_/g, " ")} - Quant Lite Library` : "Strategy Not Found - Quant Lite" };
}

export default async function StrategyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const entry = LIBRARY_SAMPLE.find((e) => e.id === id);
  if (!entry) notFound();

  return (
    <main className="min-h-screen bg-ink pt-20 text-text">
      <Navbar />
      <section className="mx-auto max-w-3xl space-y-6 px-6 py-12">
        <div>
          <LegacyEvidenceBadge />
          <h1 className="mt-2 text-2xl font-semibold capitalize text-text">{entry.triggerKey.replace(/_/g, " ")} strategy</h1>
          <p className="mt-1 text-sm text-text-3">
            {entry.symbol} &middot; {entry.timeframe} &middot; {entry.riskPreset} risk preset
          </p>
        </div>

        <Card>
          <h2 className="mb-3 text-sm font-semibold text-text">Historical Evidence</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <MetricTile label="Profit Factor" value={entry.profitFactor} format="ratio" />
            <MetricTile label="Return" value={entry.totalReturnPct} format="percent" />
            <MetricTile label="Max Drawdown" value={entry.maxDrawdownPct} format="percent" positiveIsGood={false} />
            <MetricTile label="Win Rate" value={entry.winRatePct} format="rate" />
            <MetricTile label="Total Trades" value={entry.tradesTotal} format="integer" />
            <MetricTile label="Walk-Forward Robustness" value={entry.wfRobustnessScore} format="ratio" />
          </div>
          <p className="mt-4 text-xs text-text-3">
            This result predates the canonical execution engine (execution_mtf.py) and the account-blown
            correctness fix - it is not directly comparable to a fresh Quant Lite backtest and is not
            validated performance.
          </p>
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-semibold text-text">Strategy Rules</h2>
          <StrategyRuleSummary spec={entry.spec} />
        </Card>

        <ExecutionAssumptionsPanel />

        <ButtonLink href="/quant-lite/builder" size="lg">
          Run Fresh Backtest
        </ButtonLink>
      </section>
      <Footer />
    </main>
  );
}
