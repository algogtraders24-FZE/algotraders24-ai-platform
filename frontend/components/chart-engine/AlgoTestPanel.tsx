"use client";

// components/chart-engine/AlgoTestPanel.tsx
// P3.2B - the first real end-to-end Native Chart Algo Testing vertical
// slice. Slots into NativeChart.tsx in the same vertical stack
// PaperTradingPanel already occupies, gated the same way
// (isActive={symbol === activeSymbol}) - only the primary/active pane
// shows it. Deliberately narrow this release: strategy/symbol/timeframe
// are fixed to the Golden Strategy / XAUUSD / M5 (algo-test.service.ts's
// own SUPPORTED_* constants) - only the date range and initial balance are
// genuinely editable. The server (algo-test.service.ts) is the ONLY place
// that calls at24-quant-engine - this component only ever renders numbers
// the engine already computed (metrics/trades/equityCurve), never
// recalculates any of them.
import { forwardRef, useImperativeHandle, useState } from "react";
import Badge from "@/components/ui/Badge";
import Modal from "@/components/ui/Modal";
import StatField from "@/components/workspace/StatField";
import { FIN_LABEL, FIN_PRIMARY, FIN_SECONDARY, FIN_TERTIARY } from "@/components/ui/financial-typography";
import { formatPrice, formatPercent, formatTimestamp } from "@/lib/financial-format";
import { runAlgoTest } from "@/lib/algo-test/store";
import type { AlgoTestRunView, AlgoTestTradeView } from "@/types/algo-test";
import type { AlgoTestTradeMarker } from "@/lib/chart-engine/renderer";
import type { ChartCandle } from "@/types/chart-data";

export interface AlgoTestChartOverlay {
  candles: ChartCandle[];
  trades: AlgoTestTradeMarker[];
}

export interface AlgoTestPanelProps {
  symbol: string;
  isActive: boolean;
  onOverlayChange: (overlay: AlgoTestChartOverlay | null) => void;
  selectedTradeId: string | null;
  onSelectTrade: (tradeId: string | null) => void;
}

export interface AlgoTestPanelHandle {
  /** The toolbar's "Algo Test" button (ChartToolbar.tsx) drives this - same imperative-surface pattern PaperTradingPanelHandle.quickTrade already established. */
  openConfig: () => void;
}

// This release's only supported combination (algo-test.service.ts's own
// SUPPORTED_STRATEGY_IDS/SUPPORTED_SYMBOLS/SUPPORTED_TIMEFRAMES) - shown
// here as fixed, disabled fields rather than a dropdown with one option,
// so the UI is honest about what's actually selectable today.
const FIXED_STRATEGY_LABEL = "Golden Strategy";
const FIXED_SYMBOL = "XAUUSD";
const FIXED_TIMEFRAME_LABEL = "M5";
const DEFAULT_INITIAL_BALANCE = 10_000;
const MAX_RANGE_DAYS = 14;

function isoDateNDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function toEngineTimestamp(dateOnly: string, endOfDay: boolean): string {
  return `${dateOnly}T${endOfDay ? "23:59:59" : "00:00:00"}Z`;
}

const AlgoTestPanel = forwardRef<AlgoTestPanelHandle, AlgoTestPanelProps>(function AlgoTestPanel(
  { symbol, isActive, onOverlayChange, selectedTradeId, onSelectTrade },
  ref,
) {
  const [configOpen, setConfigOpen] = useState(false);
  const [startDate, setStartDate] = useState(() => isoDateNDaysAgo(7));
  const [endDate, setEndDate] = useState(() => isoDateNDaysAgo(0));
  const [initialBalance, setInitialBalance] = useState(String(DEFAULT_INITIAL_BALANCE));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [run, setRun] = useState<AlgoTestRunView | undefined>(undefined);

  useImperativeHandle(ref, () => ({ openConfig: () => setConfigOpen(true) }), []);

  if (!isActive) return null;

  // This release only supports XAUUSD (algo-test.service.ts's own
  // SUPPORTED_SYMBOLS) - a pane showing any other symbol gets an honest
  // "not yet" message rather than a config form that would only ever fail
  // server-side validation.
  if (symbol !== FIXED_SYMBOL) {
    return (
      <div className="rounded-control border border-border bg-ink-3 px-3 py-2.5">
        <p className={FIN_LABEL}>Algo Testing (Pro)</p>
        <p className={`${FIN_TERTIARY} mt-1`}>Only {FIXED_SYMBOL} is supported this release. Switch this pane&apos;s symbol to {FIXED_SYMBOL} to run a test.</p>
      </div>
    );
  }

  const rangeDays = (new Date(endDate).getTime() - new Date(startDate).getTime()) / 86_400_000;
  const parsedBalance = Number(initialBalance);
  const balanceValid = Number.isFinite(parsedBalance) && parsedBalance > 0;
  const rangeValid = rangeDays > 0 && rangeDays <= MAX_RANGE_DAYS;
  const canSubmit = balanceValid && rangeValid && !submitting;

  async function handleSubmit() {
    setSubmitting(true);
    setError(undefined);
    try {
      const result = await runAlgoTest({
        strategyId: "golden",
        symbol: FIXED_SYMBOL,
        timeframe: "5m",
        startTime: toEngineTimestamp(startDate, false),
        endTime: toEngineTimestamp(endDate, true),
        initialBalance: parsedBalance,
      });
      setRun(result);
      onSelectTrade(null);
      if (result.status === "completed" && result.candles && result.trades) {
        onOverlayChange({
          candles: result.candles,
          trades: result.trades.map(
            (t): AlgoTestTradeMarker => ({ tradeId: t.tradeId, side: t.side, entryTime: t.entryTime, entryPrice: t.entryPrice, exitTime: t.exitTime, exitPrice: t.exitPrice }),
          ),
        });
        setConfigOpen(false);
      } else {
        setError(result.errorMessage ?? "The test did not complete.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run Algo Test");
    } finally {
      setSubmitting(false);
    }
  }

  function handleClearResults() {
    setRun(undefined);
    onSelectTrade(null);
    onOverlayChange(null);
  }

  return (
    <div className="rounded-control border border-border bg-ink-3 px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className={FIN_LABEL}>Algo Testing (Pro)</p>
        {run && (
          <button type="button" onClick={handleClearResults} className="text-[11px] text-text-3 underline decoration-dotted hover:text-text-2">
            Clear results
          </button>
        )}
      </div>

      {!run && <p className={`${FIN_TERTIARY} mt-1`}>Run the Golden Strategy against real historical {FIXED_SYMBOL} data. Click &quot;Algo Test&quot; in the chart toolbar to configure a run.</p>}

      {run && run.status === "completed" && run.metrics && (
        <AlgoTestResults run={run} selectedTradeId={selectedTradeId} onSelectTrade={onSelectTrade} />
      )}

      <Modal open={configOpen} onClose={() => setConfigOpen(false)} title="Configure Algo Test">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <StatField label="Strategy" bare>
              <span className={FIN_SECONDARY}>{FIXED_STRATEGY_LABEL}</span>
            </StatField>
            <StatField label="Symbol / Timeframe" bare>
              <span className={FIN_SECONDARY}>
                {FIXED_SYMBOL} · {FIXED_TIMEFRAME_LABEL}
              </span>
            </StatField>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-0.5">
              <span className={FIN_LABEL}>Start Date</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-control border border-border bg-ink px-2 py-1.5 text-sm text-text"
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className={FIN_LABEL}>End Date</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded-control border border-border bg-ink px-2 py-1.5 text-sm text-text"
              />
            </label>
          </div>
          <label className="flex flex-col gap-0.5">
            <span className={FIN_LABEL}>Initial Balance</span>
            <input
              type="number"
              min="0"
              step="any"
              value={initialBalance}
              onChange={(e) => setInitialBalance(e.target.value)}
              className="w-full rounded-control border border-border bg-ink px-2 py-1.5 text-sm text-text"
            />
          </label>
          {!rangeValid && (
            <p className="text-[11px] text-danger">
              {rangeDays <= 0 ? "Start date must be before end date." : `Range must be ${MAX_RANGE_DAYS} days or less (currently ${rangeDays.toFixed(1)}).`}
            </p>
          )}
          <p className={FIN_TERTIARY}>
            Real historical data via Twelve Data. Execution assumptions (spread/slippage/fees are zero-cost placeholders; margin is not enforced) are shown with every result - never claimed to be broker-realistic.
          </p>
          {error && <p className="text-[11px] text-danger">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setConfigOpen(false)} className="rounded-control border border-border px-3 py-1.5 text-xs text-text-2">
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="rounded-control border border-gold/40 bg-gold/10 px-3 py-1.5 text-xs font-semibold text-gold transition hover:bg-gold/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting ? "Running Algo Test…" : "Run Backtest"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
});

export default AlgoTestPanel;

function AlgoTestResults({
  run,
  selectedTradeId,
  onSelectTrade,
}: {
  run: AlgoTestRunView;
  selectedTradeId: string | null;
  onSelectTrade: (tradeId: string | null) => void;
}) {
  const metrics = run.metrics!;
  const trades = run.trades ?? [];
  const netPnlClass = metrics.netProfit >= 0 ? "text-signal-up" : "text-signal-down";

  return (
    <div className="mt-2 space-y-2.5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
        <StatField label="Total Trades">
          <span className={FIN_PRIMARY}>{metrics.tradeCount}</span>
        </StatField>
        <StatField label="Win Rate">
          <span className={FIN_SECONDARY}>{formatPercent(metrics.winRate, { signed: false })}</span>
        </StatField>
        <StatField label="Net P&L">
          <span className={`fin-num font-mono ${netPnlClass}`}>{formatPrice(metrics.netProfit, { maxDecimals: 2 })}</span>
        </StatField>
        <StatField label="Profit Factor">
          <span className={FIN_SECONDARY}>{Number.isFinite(metrics.profitFactor) ? metrics.profitFactor.toFixed(2) : "∞"}</span>
        </StatField>
        <StatField label="Max Drawdown">
          <span className={FIN_SECONDARY}>{formatPrice(metrics.maxDrawdown, { maxDecimals: 2 })}</span>
        </StatField>
        <StatField label="Final Equity">
          <span className={FIN_PRIMARY}>{formatPrice(run.initialBalance + metrics.netProfit, { maxDecimals: 2 })}</span>
        </StatField>
      </div>

      <ExecutionAssumptions assumptions={run.assumptions} />

      {run.equityCurve && run.equityCurve.length > 1 && <EquityCurveSparkline points={run.equityCurve} />}

      {trades.length > 0 && (
        <div className="overflow-x-auto">
          <p className={`${FIN_LABEL} mb-1`}>Trades ({trades.length})</p>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className={FIN_LABEL}>
                <th className="pb-1 pr-2">#</th>
                <th className="pb-1 pr-2">Side</th>
                <th className="pb-1 pr-2">Entry</th>
                <th className="pb-1 pr-2">Exit</th>
                <th className="pb-1 pr-2">P&amp;L</th>
                <th className="pb-1 pr-2">R</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t, i) => (
                <TradeRow key={t.tradeId} index={i + 1} trade={t} selected={t.tradeId === selectedTradeId} onSelect={() => onSelectTrade(t.tradeId === selectedTradeId ? null : t.tradeId)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TradeRow({ index, trade, selected, onSelect }: { index: number; trade: AlgoTestTradeView; selected: boolean; onSelect: () => void }) {
  const pnlClass = trade.pnl >= 0 ? "text-signal-up" : "text-signal-down";
  return (
    <tr
      onClick={onSelect}
      className={`cursor-pointer border-t border-border transition ${selected ? "bg-gold/10" : "hover:bg-ink-4"}`}
    >
      <td className={`py-1 pr-2 ${FIN_TERTIARY}`}>{index}</td>
      <td className="py-1 pr-2">
        <Badge tone={trade.side === "BUY" ? "success" : "danger"}>{trade.side}</Badge>
      </td>
      <td className={`py-1 pr-2 ${FIN_SECONDARY}`} title={formatTimestamp(trade.entryTime, "datetime")}>
        {formatPrice(trade.entryPrice, { maxDecimals: 5 })}
      </td>
      <td className={`py-1 pr-2 ${FIN_SECONDARY}`} title={formatTimestamp(trade.exitTime, "datetime")}>
        {formatPrice(trade.exitPrice, { maxDecimals: 5 })}
      </td>
      <td className={`py-1 pr-2 fin-num font-mono ${pnlClass}`}>
        {trade.pnl >= 0 ? "+" : ""}
        {formatPrice(trade.pnl, { maxDecimals: 2 })}
      </td>
      <td className={`py-1 pr-2 ${FIN_SECONDARY}`}>{trade.rMultiple === null ? "—" : `${trade.rMultiple.toFixed(2)}R`}</td>
    </tr>
  );
}

/** Every field here is the engine's own real, currently-in-effect assumption (algo-test.service.ts's buildAssumptions()) - rendered verbatim, never re-derived. */
function ExecutionAssumptions({ assumptions }: { assumptions: AlgoTestRunView["assumptions"] }) {
  if (!assumptions) return null;
  return (
    <div className="rounded-control border border-dashed border-border bg-ink px-2.5 py-2">
      <p className={FIN_LABEL}>Execution Assumptions</p>
      <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] sm:grid-cols-4">
        <div>
          <dt className="text-text-3">Spread</dt>
          <dd className="text-text-2">{assumptions.spread}</dd>
        </div>
        <div>
          <dt className="text-text-3">Slippage</dt>
          <dd className="text-text-2">{assumptions.slippage}</dd>
        </div>
        <div>
          <dt className="text-text-3">Fees</dt>
          <dd className="text-text-2">{assumptions.fees}</dd>
        </div>
        <div>
          <dt className="text-text-3">Margin</dt>
          <dd className="text-text-2">{assumptions.margin}</dd>
        </div>
      </dl>
      <p className="mt-1.5 text-[11px] text-text-3">These are the engine&apos;s real, currently-in-effect assumptions - not a claim of broker-realistic execution.</p>
    </div>
  );
}

// A minimal, self-contained inline SVG sparkline - deliberately NOT reusing
// Quant Lite's own EquityCurveChart.tsx (a different, unrelated system -
// docs/P3.2A-QUANT-LITE-BOUNDARY.md) or the Native Chart canvas engine
// (disproportionate for one small line). Plots the engine's own real
// equityCurve points as-is - never recomputed from the trade list.
function EquityCurveSparkline({ points }: { points: readonly { timestamp: number; balance: number }[] }) {
  const WIDTH = 560;
  const HEIGHT = 64;
  const PAD = 4;
  const balances = points.map((p) => p.balance);
  const min = Math.min(...balances);
  const max = Math.max(...balances);
  const span = max - min || 1;
  const pathD = points
    .map((p, i) => {
      const x = PAD + (i / Math.max(1, points.length - 1)) * (WIDTH - PAD * 2);
      const y = HEIGHT - PAD - ((p.balance - min) / span) * (HEIGHT - PAD * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const last = points[points.length - 1]!;
  const first = points[0]!;
  const up = last.balance >= first.balance;

  return (
    <div>
      <p className={`${FIN_LABEL} mb-1`}>Equity Curve</p>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-16 w-full" preserveAspectRatio="none" role="img" aria-label="Equity curve">
        <path d={pathD} fill="none" stroke={up ? "#3fb27f" : "#d1594a"} strokeWidth={1.5} />
      </svg>
    </div>
  );
}
