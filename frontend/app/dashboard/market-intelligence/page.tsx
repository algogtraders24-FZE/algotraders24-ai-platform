"use client";

// app/dashboard/market-intelligence/page.tsx
// Sprint L2.1 - First real wiring of the Sprint 15D deterministic pipeline
// into a page a user can actually open. Previously this page rendered a
// hardcoded static array (data/market-intelligence.ts, now deleted) via a
// legacy mock service - this now calls the real
// /api/private/market-intelligence/analyze route, which runs the actual
// evidence -> reasoning -> risk -> confidence -> explainable-analysis
// pipeline against live market data.
//
// Sprint D2.3.S3 - the analyze route's price provider moved from Alpha
// Vantage (EURUSD only, on the configured key/tier) to Twelve Data, which
// maps EURUSD, GBPUSD, USDJPY, XAUUSD, XAGUSD, BTCUSD, and ETHUSD (see the
// route's header). All seven are real "Run Analysis" buttons now - there is
// no PENDING_MARKETS list left, because nothing here is pending anymore.
//
// Sprint UI-02.1 - visual-only pass onto the UI-01 system: the page's own
// min-h-screen/max-w wrapper is gone (AppShell already provides the ink
// background and centered content column - Overview has no self-wrapper
// either), hand-rolled market/idle/error boxes are now Card/EmptyState, and
// both buttons are the shared Button primitive (Run Analysis uses its
// built-in `loading` spinner instead of a manual text swap). Same fetch
// call, same states, same data - no behavior change.
import { useState } from "react";
import type { MarketAnalysisResult } from "@/types/market-analysis-orchestration";
import AnalysisResult from "@/components/market-intelligence/AnalysisResult";
import PageHeader from "@/components/ui/PageHeader";
import ErrorState from "@/components/ui/ErrorState";
import EmptyState from "@/components/ui/EmptyState";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";

const AVAILABLE_MARKETS = [
  { symbol: "EURUSD", label: "Euro", pair: "EUR/USD" },
  { symbol: "GBPUSD", label: "British Pound", pair: "GBP/USD" },
  { symbol: "USDJPY", label: "US Dollar / Yen", pair: "USD/JPY" },
  { symbol: "XAUUSD", label: "Gold", pair: "XAU/USD" },
  { symbol: "XAGUSD", label: "Silver", pair: "XAG/USD" },
  { symbol: "BTCUSD", label: "Bitcoin", pair: "BTC/USD" },
  { symbol: "ETHUSD", label: "Ethereum", pair: "ETH/USD" },
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
    <div className="space-y-8">
      <PageHeader
        eyebrow="Market Intelligence"
        title="Run a real analysis"
        description="Powered by the deterministic evidence → reasoning → risk → confidence → explainable-analysis pipeline. More markets are being added as data sources are connected."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {AVAILABLE_MARKETS.map((market) => {
          const isThis = run.status !== "idle" && run.symbol === market.symbol;
          const loading = isThis && run.status === "loading";
          const active = isThis && run.status === "completed";
          return (
            <Card key={market.symbol} className={active ? "border-gold/40" : ""}>
              <p className="text-lg font-semibold text-text">{market.label}</p>
              <p className="mt-1 font-mono text-xs text-text-3">{market.pair}</p>
              <Button
                type="button"
                onClick={() => runAnalysis(market.symbol)}
                loading={loading}
                className="mt-4"
              >
                Run Analysis
              </Button>
            </Card>
          );
        })}
      </div>

      <div>
        {run.status === "idle" && (
          <EmptyState
            title="No analysis yet"
            description="Click Run Analysis on any market above to generate your first evidence-backed market analysis - it runs the real pipeline against live data, so it takes a few seconds."
          />
        )}

        {run.status === "loading" && (
          <Card className="flex items-center gap-3 text-sm text-text-2">
            <Spinner size="sm" />
            Running the deterministic pipeline against live market data — this takes a few seconds.
          </Card>
        )}

        {run.status === "error" && (
          <ErrorState
            title="Analysis unavailable"
            description={run.message}
            action={
              <Button type="button" variant="secondary" size="sm" onClick={() => runAnalysis(run.symbol)}>
                Retry
              </Button>
            }
          />
        )}

        {run.status === "completed" && <AnalysisResult result={run.result} />}
      </div>
    </div>
  );
}
