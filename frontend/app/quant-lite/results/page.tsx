// app/quant-lite/results/page.tsx
// Sprint IA2 - the WORKSPACE/Results slot in the backoffice IA (see
// docs/IA1-BACKOFFICE-NAVIGATION-REFACTOR.md) previously pointed at the
// Strategy Library as a stand-in, since Quant Lite has no real per-account
// results history (backend has no userId on a job at all - see
// services/quant-lite/recentRuns.ts's own header comment). This is the
// honest, buildable version: a per-browser list of jobs this device has
// actually submitted, recorded by BacktestSetupForm at submit time and
// read back here - client-only, since it reads localStorage.
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import ButtonLink from "@/components/ui/ButtonLink";
import EmptyState from "@/components/ui/EmptyState";
import { loadRecentRuns, type RecentRun } from "@/services/quant-lite/recentRuns";

export default function ResultsIndexPage() {
  const [runs, setRuns] = useState<RecentRun[] | null>(null);

  useEffect(() => {
    setRuns(loadRecentRuns());
  }, []);

  return (
    <main className="min-h-screen bg-ink pt-20 text-text">
      <Navbar />
      <section className="mx-auto max-w-5xl px-6 py-12">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-text">Results</h1>
            <p className="mt-1 max-w-2xl text-sm text-text-3">
              Backtests you've run from this browser. This list lives on your device, not your account - clearing
              your browser data or switching devices will lose it. For a fixed, shared set of research-evidence
              results, see the Strategy Library instead.
            </p>
          </div>
          <ButtonLink href="/quant-lite/backtest" variant="secondary">
            Run a new backtest →
          </ButtonLink>
        </div>

        <div className="mt-8">
          {runs === null ? null : runs.length === 0 ? (
            <EmptyState
              title="No backtests run yet on this device."
              description="Run a backtest from the Backtest Setup screen and it will show up here."
              action={<ButtonLink href="/quant-lite/backtest">Go to Backtest Setup</ButtonLink>}
            />
          ) : (
            <div className="space-y-3">
              {runs.map((run) => (
                <Link
                  key={run.jobId}
                  href={`/quant-lite/results/${run.jobId}`}
                  className="block rounded-card border border-border bg-ink-2 p-5 transition hover:border-gold"
                >
                  <p className="font-semibold text-text">{run.name}</p>
                  <p className="mt-1 text-xs text-text-3">
                    {run.symbol} &middot; {run.timeframe} &middot; {new Date(run.submittedAt).toLocaleString()}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
      <Footer />
    </main>
  );
}
