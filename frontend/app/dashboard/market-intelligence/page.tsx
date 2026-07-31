"use client";

// app/dashboard/market-intelligence/page.tsx
// Sprint L2.1 - First real wiring of the Sprint 15D deterministic pipeline
// into a page a user can actually open. Previously this page rendered a
// hardcoded static array (data/market-intelligence.ts, now deleted) via a
// legacy mock service - this now calls the real
// /api/private/market-intelligence/analyze route, which runs the actual
// evidence -> reasoning -> risk -> confidence -> explainable-analysis
// pipeline against live Alpha Vantage data.
//
// EUR/USD is the only symbol wired to a working "Run Analysis" button:
// live testing during this sprint confirmed it's the one market the
// configured Alpha Vantage key actually serves through the
// currency-exchange-rate endpoint. Gold and Silver were the originally
// planned symbols and the pipeline code fully supports them - the current
// key/tier just doesn't (see lib/market-data/providers/alpha-vantage.
// provider.ts's header for the evidence). They're shown, not hidden, but
// honestly marked pending rather than given a button that would always
// fail - the same standard the homepage has held itself to since H1.3.
import { useState } from "react";
import type { MarketAnalysisResult } from "@/types/market-analysis-orchestration";
import AnalysisResult from "@/components/market-intelligence/AnalysisResult";

const AVAILABLE_MARKETS = [{ symbol: "EURUSD", label: "Euro", pair: "EUR/USD" }] as const;
const PENDING_MARKETS = [
  { label: "Gold", pair: "XAU/USD" },
  { label: "Silver", pair: "XAG/USD" },
] as const;
type Symbol = (typeof AVAILABLE_MARKETS)[number]["symbol"];

type RunState =
  | { status: "idle" }
  | { status: "loading"; symbol: Symbol }
  | { status: "error"; symbol: Symbol; message: string }
  | { status: "completed"; symbol: Symbol; result: MarketAnalysisResult };

export default function MarketIntelligencePage() {
  const [run, setRun] = useState<RunState>({ status: "idle" });

  const runAnalysis = async (symbol: Symbol) => {
    setRun({ status: "loading", symbol });
    try {
      const res = await fetch("/api/private/market-intelligence/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
      const json = (await res.json().catch(() => null)) as {
        status?: string;
        data?: { result?: MarketAnalysisResult };
        error?: { code?: string; message?: string };
      } | null;

      if (!res.ok || !json || json.status !== "ok" || !json.data?.result) {
        setRun({
          status: "error",
          symbol,
          message: json?.error?.message || "The analysis could not be completed.",
        });
        return;
      }
      setRun({ status: "completed", symbol, result: json.data.result });
    } catch {
      setRun({ status: "error", symbol, message: "Network error - could not reach the analysis service." });
    }
  };

  return (
    <div className="min-h-screen bg-ink p-6 text-text">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-gold">Market Intelligence</p>
          <h1 className="mt-2 font-display text-3xl font-medium">Run a real analysis</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-text-2">
            Powered by the deterministic evidence → reasoning → risk → confidence → explainable-analysis pipeline.
            More markets are being added as data sources are connected.
          </p>
        </header>

        <div className="grid gap-4 sm:grid-cols-3">
          {AVAILABLE_MARKETS.map((market) => {
            const isThis = run.status !== "idle" && run.symbol === market.symbol;
            const loading = isThis && run.status === "loading";
            return (
              <div key={market.symbol} className="rounded-card border border-border bg-ink-2 p-6">
                <p className="text-lg font-semibold">{market.label}</p>
                <p className="mt-1 font-mono text-xs text-text-3">{market.pair}</p>
                <button
                  type="button"
                  onClick={() => runAnalysis(market.symbol)}
                  disabled={loading}
                  className="mt-4 rounded-control bg-gold px-5 py-2.5 text-sm font-semibold text-ink transition hover:brightness-110 disabled:opacity-50"
                >
                  {loading ? "Running analysis…" : "Run Analysis"}
                </button>
              </div>
            );
          })}

          {PENDING_MARKETS.map((market) => (
            <div key={market.pair} className="rounded-card border border-border bg-ink-2 p-6 opacity-60">
              <p className="text-lg font-semibold">{market.label}</p>
              <p className="mt-1 font-mono text-xs text-text-3">{market.pair}</p>
              <span className="mt-4 inline-block rounded-control border border-border px-3 py-1 text-xs font-medium text-text-3">
                Pending data source
              </span>
            </div>
          ))}
        </div>

        <div className="mt-8">
          {run.status === "idle" && (
            <div className="rounded-card border border-dashed border-border bg-ink-2/50 p-6 text-sm text-text-2">
              <p className="font-semibold text-text">No analysis yet</p>
              <p className="mt-1">
                Click <span className="text-text">Run Analysis</span> on Euro above to generate your first
                evidence-backed market analysis - it runs the real pipeline against live data, so it takes a few
                seconds.
              </p>
            </div>
          )}

          {run.status === "loading" && (
            <div className="rounded-card border border-border bg-ink-2 p-6 text-sm text-text-2">
              Running the deterministic pipeline against live market data — this takes a few seconds.
            </div>
          )}

          {run.status === "error" && (
            <div className="rounded-card border border-signal-down/30 bg-signal-down/10 p-6">
              <p className="text-sm font-semibold text-signal-down">Analysis unavailable</p>
              <p className="mt-1 text-sm text-text-2">{run.message}</p>
              <button
                type="button"
                onClick={() => runAnalysis(run.symbol)}
                className="mt-4 rounded-control border border-border px-4 py-2 text-sm font-medium text-text transition hover:border-gold"
              >
                Retry
              </button>
            </div>
          )}

          {run.status === "completed" && <AnalysisResult result={run.result} />}
        </div>
      </div>
    </div>
  );
}
