"use client";
// app/quant-lite/results/[id]/ResultsView.tsx
// Q0.9 Part 22/23/24 - polls the REAL job (id = jobId) and renders its
// actual QUEUED/RUNNING/COMPLETED/FAILED state. Top-level metrics never
// hidden below the fold; the disclaimer and execution-assumptions panel
// are always visible on a completed result, never behind an extra click
// (Q0.7_UI_INFORMATION_ARCHITECTURE Part 9's explicit rule).
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Spinner from "@/components/ui/Spinner";
import MetricTile from "@/components/quant-lite/MetricTile";
import EquityCurveChart from "@/components/quant-lite/EquityCurveChart";
import TradeTable from "@/components/quant-lite/TradeTable";
import ExecutionAssumptionsPanel from "@/components/quant-lite/ExecutionAssumptionsPanel";
import CoverageAssessmentPanel from "@/components/quant-lite/CoverageAssessmentPanel";
import CodeGenerationPanel from "@/components/quant-lite/CodeGenerationPanel";
import { getBacktestJob, QuantLiteApiError } from "@/services/quant-lite/QuantLiteBacktestService";
import type { GetBacktestJobResponse } from "@/types/quant-lite-job";

const POLL_INTERVAL_MS = 1500;

const ERROR_COPY: Record<string, string> = {
  INVALID_REQUEST: "The request was invalid.",
  // Q1.7 Part 9 - was missing, so this real failure mode (a strategy that
  // passes the lighter Node-side pre-check but fails schema.py's fuller
  // validate_spec() once the engine actually runs it - e.g. an undeclared
  // condition ref) always showed the generic UNKNOWN_ERROR copy below
  // instead of this clearer one.
  INVALID_STRATEGY: "The strategy specification failed validation.",
  DATA_UNAVAILABLE: "The requested symbol, timeframe, or date range is not available in the audited dataset.",
  BACKTEST_FAILED: "The backtest could not complete.",
  BACKTEST_TIMEOUT: "The backtest took too long and was stopped.",
  ENGINE_ERROR: "The backtest engine encountered an unexpected error.",
  RESULT_INVALID: "The engine's result could not be read.",
  UNKNOWN_ERROR: "An unknown error occurred.",
  NOT_FOUND: "This job could not be found.",
};

export default function ResultsView({ backtestId }: { backtestId: string }) {
  const router = useRouter();
  const [job, setJob] = useState<GetBacktestJobResponse | null | undefined>(undefined);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const result = await getBacktestJob(backtestId);
        if (cancelled) return;
        setJob(result);
        setFetchError(null);
        if (result.status === "QUEUED" || result.status === "RUNNING") {
          timerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch (e) {
        if (cancelled) return;
        if (e instanceof QuantLiteApiError && e.code === "NOT_FOUND") {
          setJob(null);
        } else {
          setFetchError(e instanceof QuantLiteApiError ? e.message : "Could not reach the backtest service.");
          timerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
        }
      }
    }

    void poll();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [backtestId]);

  if (job === undefined && !fetchError) return null;

  if (job === null) {
    return (
      <EmptyState
        title="Backtest not found"
        description="This job does not exist, or the server has restarted since it ran. Run a new backtest to see results."
        action={<Button onClick={() => router.push("/quant-lite/builder")}>Go to Strategy Builder</Button>}
      />
    );
  }

  if (fetchError && !job) {
    return <p className="text-sm text-danger">{fetchError}</p>;
  }

  if (!job) return null;

  if (job.status === "QUEUED" || job.status === "RUNNING") {
    return (
      <div className="space-y-6">
        <Card padding="lg">
          <div className="flex flex-col items-center gap-4 py-10 text-center">
            <Spinner size="lg" />
            <p className="text-sm font-semibold text-text">
              {job.status === "QUEUED" ? "Backtest Queued" : "Backtest Running"}
            </p>
            <p className="text-sm text-text-2">
              {job.status === "QUEUED"
                ? "Waiting for a free execution slot..."
                : "Running against the canonical execution_mtf.py engine over real market data..."}
            </p>
            {job.dataQuality && (
              <p className="text-xs text-text-3">
                {job.dataQuality.symbol} &middot; {job.dataQuality.timeframe} &middot; {job.dataQuality.requested.start} to {job.dataQuality.requested.end}
              </p>
            )}
            <p className="text-xs text-text-3">Job {job.jobId}</p>
          </div>
        </Card>
        <CoverageAssessmentPanel assessment={job.dataQuality} />
      </div>
    );
  }

  if (job.status === "FAILED") {
    const code = job.error?.code ?? "UNKNOWN_ERROR";
    return (
      <div className="space-y-4">
        <EmptyState
          title="Backtest failed"
          description={`${ERROR_COPY[code] ?? ERROR_COPY.UNKNOWN_ERROR} ${job.error?.message ?? ""}`.trim()}
          action={<Button onClick={() => router.push("/quant-lite/backtest")}>Try Again</Button>}
        />
        {job.error?.details && job.error.details.length > 0 && (
          <Card>
            <p className="mb-2 text-xs font-semibold text-text-3">Details</p>
            <ul className="list-disc space-y-1 pl-5 text-xs text-text-3">
              {job.error.details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          </Card>
        )}
        <p className="text-xs text-text-3">Job {job.jobId} &middot; failed after {job.durationMs ? `${(job.durationMs / 1000).toFixed(1)}s` : "an unknown duration"}.</p>
      </div>
    );
  }

  if (job.status === "CANCELLED") {
    return (
      <EmptyState
        title="Backtest cancelled"
        description="This backtest was cancelled before it completed."
        action={<Button onClick={() => router.push("/quant-lite/backtest")}>Try Again</Button>}
      />
    );
  }

  const result = job.result;
  if (!result) {
    return (
      <EmptyState
        title="Result not available"
        description="This job completed but no result was recorded. This is an engine-side inconsistency, not a missing feature - please try again."
        action={<Button onClick={() => router.push("/quant-lite/backtest")}>Try Again</Button>}
      />
    );
  }

  const { metrics, trades, assumptions, warnings, provenance } = result;
  const startBalance = provenance.initialCapital;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-gold">Backtest Result</p>
        <h1 className="mt-1 text-2xl font-semibold text-text">{result.strategyName}</h1>
        <p className="mt-1 text-xs text-text-3">
          {provenance.symbol} &middot; {provenance.timeframe} &middot; {provenance.dateRange.start} to {provenance.dateRange.end}
        </p>
      </div>

      {result.resultDataQualityStatus === "DATA_QUALITY_RESTRICTED" && (
        <p className="rounded-control border border-danger/40 bg-danger/10 p-3 text-sm font-semibold text-danger">
          DATA QUALITY RESTRICTED - this result is real, but the underlying historical data for this period is severely
          fragmented. It does not represent continuous market conditions and should not be compared to a normal backtest.
          See the data coverage panel below for exactly what was and was not covered.
        </p>
      )}

      <CoverageAssessmentPanel assessment={provenance.dataQuality ?? null} />

      {warnings.length > 0 && (
        <div className="space-y-2">
          {warnings.map((w, i) => (
            <p key={i} className="rounded-control border border-info/30 bg-info/10 p-3 text-sm text-text-2">
              {w}
            </p>
          ))}
        </div>
      )}

      {metrics.accountBlown && (
        <p className="rounded-control border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          This backtest lost the entire account balance during the test period (account blown).
        </p>
      )}

      <Card>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <MetricTile label="Return" value={metrics.totalReturnPct} format="percent" />
          <MetricTile label="Profit Factor" value={metrics.profitFactor} format="ratio" />
          <MetricTile label="Win Rate" value={metrics.winRatePct} format="rate" positiveIsGood />
          <MetricTile label="Max Drawdown" value={metrics.maxDrawdownPct} format="percent" positiveIsGood={false} />
          <MetricTile label="Total Trades" value={metrics.tradesTotal} format="integer" />
          <MetricTile label="Final Balance" value={metrics.finalBalance} format="currency" />
        </div>
      </Card>

      <Card>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <MetricTile label="Winning Trades" value={metrics.winningTrades} format="integer" />
          <MetricTile label="Losing Trades" value={metrics.losingTrades} format="integer" />
          <MetricTile label="Average Trade" value={metrics.averageTrade} format="currency" />
          <MetricTile label="Largest Win" value={metrics.largestWin} format="currency" />
          <MetricTile label="Largest Loss" value={metrics.largestLoss} format="currency" positiveIsGood={false} />
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-text">Equity Curve</h2>
        <EquityCurveChart trades={trades} startBalance={startBalance} />
      </Card>

      <Card padding="none">
        <div className="p-4">
          <h2 className="text-sm font-semibold text-text">Trade List</h2>
        </div>
        <TradeTable trades={trades} />
      </Card>

      <ExecutionAssumptionsPanel assumptions={assumptions} />

      {job.strategy && <CodeGenerationPanel strategy={job.strategy} />}

      <p className="text-xs text-text-3">
        Backtest results are historical simulation results and are not a guarantee of future performance.{" "}
        <Link href="/quant-lite#how-it-works" className="underline decoration-border underline-offset-4 hover:text-gold">
          Learn how this backtest works
        </Link>
        .
      </p>

      <div className="flex flex-wrap items-center gap-2 text-xs text-text-3">
        <Badge tone="neutral">Engine: {provenance.engineVersion}</Badge>
        <Badge tone="neutral">Generated: {provenance.generatedAt}</Badge>
        <Badge tone="neutral">Job: {job.jobId}</Badge>
      </div>
    </div>
  );
}
