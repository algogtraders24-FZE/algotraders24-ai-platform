// components/quant-chat/BacktestResultCard.tsx
// QP-4 - Quant Chat -> Run Backtest. A small, lightweight in-chat summary
// of a real AlgoTestRunView (the SAME result shape the canonical
// compileAndRunAiStrategy() already returns - never an invented metric
// name or a new result DTO). Deliberately does NOT embed the full
// workspace-coupled AlgoTestResults composite (same class of coupling
// QP-3 already designed around for the chart) - only the fields that
// matter for a quick in-chat glance, plus a link to the existing full
// result experience (the same /dashboard/workspace?algoTestId= convention
// app/dashboard/algo-test-history/page.tsx's own row links already use).
import Link from "next/link";
import { formatPrice, formatPercent } from "@/lib/financial-format";
import type { AlgoTestRunView } from "@/types/algo-test";

export default function BacktestResultCard({ run }: { run: AlgoTestRunView }) {
  if (run.status === "failed") {
    return (
      <div className="mt-3 rounded-2xl border border-border bg-ink p-4">
        <p className="text-xs font-semibold text-danger">Backtest failed{run.errorCode ? ` (${run.errorCode})` : ""}</p>
        {run.errorMessage && <p className="mt-1 text-[11px] text-text-3">{run.errorMessage}</p>}
      </div>
    );
  }

  const metrics = run.metrics;

  return (
    <div className="mt-3 rounded-2xl border border-border bg-ink p-4">
      <p className="text-xs font-semibold text-signal-up">Backtest complete</p>
      {metrics && (
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] sm:grid-cols-4">
          <div>
            <p className="text-text-3">Trades</p>
            <p className="fin-num text-text">{metrics.tradeCount}</p>
          </div>
          <div>
            <p className="text-text-3">Net profit</p>
            <p className="fin-num text-text">{formatPrice(metrics.netProfit, { maxDecimals: 2 })}</p>
          </div>
          <div>
            <p className="text-text-3">Win rate</p>
            <p className="fin-num text-text">{formatPercent(metrics.winRate, { signed: false })}</p>
          </div>
          <div>
            <p className="text-text-3">Max drawdown</p>
            <p className="fin-num text-text">{formatPercent(metrics.maxDrawdown, { signed: false })}</p>
          </div>
        </div>
      )}
      <Link href={`/dashboard/workspace?algoTestId=${encodeURIComponent(run.testId)}`} className="mt-3 inline-block text-[11px] font-medium text-gold hover:text-gold-strong">
        View full result &rarr;
      </Link>
    </div>
  );
}
