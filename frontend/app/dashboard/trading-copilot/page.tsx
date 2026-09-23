"use client";

// app/dashboard/trading-copilot/page.tsx
// Sprint D2.2 (Phase 7) - fully migrated off the mock pipeline. The page now
// calls /api/private/trading-copilot/analyze, which runs the centralized
// MarketDataService (Twelve Data primary + Alpha Vantage fallback) for a live
// snapshot and real OHLC candles, computes real indicators (RSI/EMA/SMA/ATR/
// MACD/Bollinger/volume), and has Gemini restate the structured context. The
// former synthetic cards (invented bias, RSI, support/resistance, trade
// setups) are gone entirely. Any indicator that cannot be computed from the
// available candles renders "Insufficient data" - never an estimate.
// Sprint UI-02.7 - cross-dashboard consistency: self min-h-screen/max-w-6xl
// wrapper removed (AppShell already provides it); the symbol <select> ->
// Select, Run Analysis/Retry raw buttons -> Button, the dashed idle box ->
// EmptyState, the loading box -> Card + Spinner (same pattern Market
// Intelligence already established). The 6 `rounded-panel` sections in
// Result() and the Metric tile's bg-ink are intentionally left as-is -
// rounded-panel is an approved 20px "hero" radius token Card can't produce
// (Card is hardcoded to rounded-card/12px), and Metric's bg-ink (vs
// Card's bg-ink-2) gives it visible depth against the bg-ink-2 section it
// sits inside - forcing either through Card would be a real token/
// hierarchy regression, not a fix. Same analyze() call, same data.
import { useState } from "react";
import type { CopilotAnalysis } from "@/services/ai/trading-copilot.service";
import { listEnabledMarkets } from "@/lib/market-data/market-registry";
import Disclaimer from "@/components/ui/Disclaimer";
import PageHeader from "@/components/ui/PageHeader";
import ErrorState from "@/components/ui/ErrorState";
import EmptyState from "@/components/ui/EmptyState";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import Spinner from "@/components/ui/Spinner";

const MARKETS = listEnabledMarkets();

type RunState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "completed"; analysis: CopilotAnalysis };

function num(value: number | undefined, digits = 4): string {
  if (value === undefined || Number.isNaN(value)) return "Insufficient data";
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function Metric({ label, value, insufficient }: { label: string; value: string; insufficient?: boolean }) {
  return (
    <div className="rounded-card border border-border bg-ink p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-text-3">{label}</p>
      <p className={`mt-1 font-mono text-sm ${insufficient ? "text-text-3 italic" : "text-text"}`}>{value}</p>
    </div>
  );
}

export default function TradingCopilotPage() {
  const [symbol, setSymbol] = useState<string>(MARKETS[0]?.symbol ?? "EURUSD");
  const [run, setRun] = useState<RunState>({ status: "idle" });

  const analyze = async () => {
    setRun({ status: "loading" });
    try {
      const res = await fetch("/api/private/trading-copilot/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
      const json = (await res.json().catch(() => null)) as {
        status?: string;
        data?: { analysis?: CopilotAnalysis };
        error?: { message?: string };
      } | null;
      if (!res.ok || !json || json.status !== "ok" || !json.data?.analysis) {
        setRun({ status: "error", message: json?.error?.message || "The analysis could not be completed." });
        return;
      }
      setRun({ status: "completed", analysis: json.data.analysis });
    } catch {
      setRun({ status: "error", message: "Network error — could not reach the analysis service." });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Trading Copilot"
        title="Real technical analysis"
        description={
          <>
            Live market data → real indicators (RSI, EMA, SMA, ATR, MACD, Bollinger) → an AI explanation of the
            computed evidence. Nothing is estimated: where history is too short, values show{" "}
            <span className="text-text">Insufficient data</span>.
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
          {MARKETS.map((m) => (
            <option key={m.symbol} value={m.symbol}>
              {m.name} ({m.symbol})
            </option>
          ))}
        </Select>
        <Button onClick={analyze} loading={run.status === "loading"}>
          Run Analysis
        </Button>
      </div>

      {run.status === "idle" && (
        <EmptyState title="No analysis yet" description="Pick a market and run a real, indicator-based analysis against live data." />
      )}

      {run.status === "loading" && (
        <Card className="flex items-center gap-3 text-sm text-text-2">
          <Spinner size="sm" />
          Fetching live data and computing indicators — this takes a few seconds.
        </Card>
      )}

      {run.status === "error" && (
        <ErrorState
          title="Analysis unavailable"
          description={run.message}
          action={
            <Button variant="secondary" size="sm" onClick={analyze}>
              Retry
            </Button>
          }
        />
      )}

      {run.status === "completed" && <Result analysis={run.analysis} />}
    </div>
  );
}

function Result({ analysis }: { analysis: CopilotAnalysis }) {
  const { snapshot, technical, risk, confidence, evidence, explanation, aiStatus } = analysis;
  const ind = technical.indicators;
  const confTone =
    confidence.band === "high"
      ? "text-signal-up"
      : confidence.band === "insufficient"
        ? "text-signal-down"
        : "text-gold";

  return (
    <div className="space-y-5">
      {/* Market Snapshot */}
      <section className="rounded-panel border border-border bg-ink-2 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">
            {snapshot.name ?? snapshot.symbol}{" "}
            <span className="font-mono text-sm text-text-3">{snapshot.symbol}</span>
          </h2>
          <span className="rounded-control border border-border px-2 py-0.5 text-xs text-text-2">
            Market {snapshot.marketStatus}
          </span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Price" value={`${num(snapshot.price, 5)} ${snapshot.quoteCurrency}`} />
          <Metric label="Change" value={snapshot.changePercent !== undefined ? `${num(snapshot.changePercent, 2)}%` : "Insufficient data"} insufficient={snapshot.changePercent === undefined} />
          <Metric label="Session High" value={num(snapshot.ohlc?.high, 5)} insufficient={!snapshot.ohlc} />
          <Metric label="Session Low" value={num(snapshot.ohlc?.low, 5)} insufficient={!snapshot.ohlc} />
        </div>
      </section>

      {/* Technical Indicators */}
      <section className="rounded-panel border border-border bg-ink-2 p-6">
        <h2 className="text-lg font-semibold">Technical Indicators</h2>
        <p className="mt-1 text-xs text-text-3">
          Computed from {technical.candleCount} candles @ {technical.interval}
          {!technical.hasSufficientData && " — limited history, some indicators unavailable"}
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="RSI (14)" value={num(ind.rsi14, 1)} insufficient={ind.rsi14 === undefined} />
          <Metric label="EMA 20" value={num(ind.ema20, 5)} insufficient={ind.ema20 === undefined} />
          <Metric label="EMA 50" value={num(ind.ema50, 5)} insufficient={ind.ema50 === undefined} />
          <Metric label="SMA 20" value={num(ind.sma20, 5)} insufficient={ind.sma20 === undefined} />
          <Metric label="ATR (14)" value={num(ind.atr14, 5)} insufficient={ind.atr14 === undefined} />
          <Metric label="MACD" value={ind.macd ? `${num(ind.macd.macd, 4)} / sig ${num(ind.macd.signal, 4)}` : "Insufficient data"} insufficient={!ind.macd} />
          <Metric label="MACD Histogram" value={num(ind.macd?.histogram, 4)} insufficient={!ind.macd} />
          <Metric label="Bollinger (20,2)" value={ind.bollinger ? `${num(ind.bollinger.lower, 4)} – ${num(ind.bollinger.upper, 4)}` : "Insufficient data"} insufficient={!ind.bollinger} />
          <Metric label="Volume (latest)" value={num(ind.volume?.latest, 0)} insufficient={ind.volume?.latest === undefined} />
        </div>
        {technical.observations.length > 0 && (
          <ul className="mt-4 space-y-1.5 text-sm text-text-2">
            {technical.observations.map((o) => (
              <li key={o}>• {o}</li>
            ))}
          </ul>
        )}
      </section>

      {/* AI Explanation + Confidence + Risk */}
      <div className="grid gap-5 lg:grid-cols-3">
        <section className="rounded-panel border border-border bg-ink-2 p-6 lg:col-span-2">
          <h2 className="text-lg font-semibold">AI Explanation</h2>
          {aiStatus === "completed" && explanation ? (
            <p className="mt-3 text-sm leading-7 text-text-2">{explanation}</p>
          ) : (
            <p className="mt-3 text-sm italic text-text-3">
              The AI explanation is unavailable right now — the computed indicators above are unaffected.
            </p>
          )}
        </section>

        <section className="space-y-5">
          <div className="rounded-panel border border-border bg-ink-2 p-6">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-text-3">Data Confidence</h3>
            <p className={`mt-2 text-2xl font-semibold capitalize ${confTone}`}>{confidence.band}</p>
            <p className="mt-1 text-xs text-text-2">{confidence.note}</p>
          </div>
          <div className="rounded-panel border border-border bg-ink-2 p-6">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-text-3">Risk</h3>
            <p className="mt-2 text-2xl font-semibold capitalize text-text">
              {risk.volatility ? `${risk.volatility} volatility` : "Insufficient data"}
            </p>
            {risk.atrPercent !== undefined && <p className="mt-1 text-xs text-text-2">ATR {num(risk.atrPercent, 2)}% of price</p>}
          </div>
        </section>
      </div>

      {/* Evidence */}
      <section className="rounded-panel border border-border bg-ink-2 p-6">
        <h2 className="text-lg font-semibold">Evidence</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {evidence.map((e) => (
            <div key={e.label}>
              <p className="text-xs font-medium uppercase tracking-wider text-text-3">{e.label}</p>
              <p className="mt-0.5 font-mono text-xs text-text-2">{e.value}</p>
            </div>
          ))}
        </div>
      </section>

      <Disclaimer />
    </div>
  );
}
