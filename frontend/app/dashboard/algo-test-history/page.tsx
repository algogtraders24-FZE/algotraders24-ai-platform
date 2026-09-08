"use client";

// app/dashboard/algo-test-history/page.tsx
// P4.7-T2 (docs/P4.7-RUN-HISTORY.md) - Run History for Algo Testing Pro.
// A client component specifically so it goes through fetchAlgoTestRuns()
// (P4.7-T1) - the same real GET /api/private/algo-test/runs a server
// component could call directly, but T1 was built specifically to give
// that endpoint its first client-side consumer; bypassing the wrapper
// here would leave it unused. Mirrors the established dashboard list-page
// shape (app/dashboard/licenses/page.tsx: EmptyState + Badge + card-row
// Link list) - not a new UI pattern.
//
// Deliberately bounded, per the locked T2 scope: no filters, no sorting,
// no pagination beyond the existing fixed 50-row server limit, no rerun/
// duplicate action, no aggregate analytics, no inline trades/equity/
// analytics payload. Every row links to the SAME existing reopen
// mechanism AlgoTestPanel already has (?algoTestId=<id> on
// /dashboard/workspace) - never a second reopen code path.
import { useEffect, useState } from "react";
import Link from "next/link";
import EmptyState from "@/components/ui/EmptyState";
import ButtonLink from "@/components/ui/ButtonLink";
import Badge, { type BadgeTone } from "@/components/ui/Badge";
import { fetchAlgoTestRuns } from "@/lib/algo-test/store";
import { formatPrice, formatPercent, formatTimestamp } from "@/lib/financial-format";
import type { AlgoTestRunView } from "@/types/algo-test";

/**
 * `AlgoTestStatus` is `"completed" | "failed"` only - there is no normal
 * "pending" lifecycle state a user would ever see here (P3.2B's
 * synchronous, no-job-queue design means a row transitions to a terminal
 * status within the same request that created it). Any OTHER value this
 * plain-string DB column could theoretically hold (an orphaned row from a
 * crashed request) is handled defensively here, never assumed impossible.
 */
function statusTone(status: string): BadgeTone {
  if (status === "completed") return "success";
  if (status === "failed") return "danger";
  return "neutral";
}

/**
 * The list view never includes `compiledStrategy` (a heavy field,
 * deliberately excluded since before P4.5) - so for a registry strategy,
 * `strategyId` ("golden", "ref-ema-crossover") is already the best
 * available label. For an AI-compiled run, `strategyId` is ALWAYS the
 * constant "ai-generated" - genuinely unhelpful as a row title, since
 * every AI-compiled row would look identical. `parameters.intent` (the
 * original natural-language request, persisted verbatim at every
 * compileAndRunAiStrategy() write site, success or failure) is already
 * part of the existing list contract - using it here is not a new field,
 * just a better use of data this view already carries.
 */
function runLabel(run: AlgoTestRunView): string {
  const intent = run.parameters?.intent;
  return typeof intent === "string" && intent.length > 0 ? intent : run.strategyId;
}

function toEpoch(iso: string): number {
  return Date.parse(iso);
}

export default function AlgoTestHistoryPage() {
  const [runs, setRuns] = useState<AlgoTestRunView[] | null>(null);

  useEffect(() => {
    fetchAlgoTestRuns().then(setRuns);
  }, []);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text">Run History</h1>
        <p className="mt-1 text-sm text-text-2">Your most recent Algo Testing Pro backtests, most recent first.</p>
      </div>

      {runs === null ? null : runs.length === 0 ? (
        <EmptyState
          title="No backtests run yet."
          description="Run a strategy from Algo Testing Pro and it will show up here."
          action={<ButtonLink href="/dashboard/workspace">Go to Algo Testing Pro</ButtonLink>}
        />
      ) : (
        <div className="space-y-3">
          {runs.map((run) => (
            <Link
              key={run.testId}
              href={`/dashboard/workspace?algoTestId=${encodeURIComponent(run.testId)}`}
              className="block rounded-2xl border border-border bg-ink-2 p-5 transition hover:border-gold"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-text" title={run.strategyId}>
                  {runLabel(run)}
                </p>
                <Badge tone={statusTone(run.status)}>{run.status}</Badge>
              </div>
              <p className="mt-1 text-xs text-text-3">
                {run.symbol} · {run.timeframe} · {formatTimestamp(toEpoch(run.startTime), "date")} – {formatTimestamp(toEpoch(run.endTime), "date")}
              </p>

              {run.status === "completed" && run.metrics ? (
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <span className="text-text-2">
                    Net P&amp;L <span className={run.metrics.netProfit >= 0 ? "text-signal-up" : "text-signal-down"}>{formatPrice(run.metrics.netProfit, { maxDecimals: 2 })}</span>
                  </span>
                  <span className="text-text-2">
                    Win Rate <span className="text-text">{formatPercent(run.metrics.winRate, { signed: false })}</span>
                  </span>
                  <span className="text-text-2">
                    Trades <span className="text-text">{run.metrics.tradeCount}</span>
                  </span>
                </div>
              ) : run.status === "failed" ? (
                <p className="mt-2 text-xs text-danger">{run.errorMessage ?? "This run failed - no further reason recorded."}</p>
              ) : (
                <p className="mt-2 text-xs text-text-3">This run never reached a completed or failed state - likely interrupted mid-request.</p>
              )}

              <p className="mt-2 text-[11px] text-text-3">
                Created {formatTimestamp(toEpoch(run.createdAt), "datetime")}
                {run.completedAt ? ` · Completed ${formatTimestamp(toEpoch(run.completedAt), "datetime")}` : " · Not completed"}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
