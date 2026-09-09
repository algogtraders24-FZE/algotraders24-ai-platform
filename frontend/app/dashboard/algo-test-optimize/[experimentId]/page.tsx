"use client";

// app/dashboard/algo-test-optimize/[experimentId]/page.tsx
// P4.9-A.4-T2 (docs/P4.9-A4-UI-CONTRACT.md, and this tier's own locked
// P4.9-A.4-T2-R1 contract) - Monitor + client-driven continuation.
// Deliberately scoped to monitor/continuation only this tier - no cancel
// button, no winner/results presentation, no candidate table (all later
// tiers, per the locked boundary). This is also the eventual Results page
// (one state-driven component tree, per the R1 contract's own locked
// decision #8/route #2) - later tiers extend the COMPLETED branch here,
// they do not replace this file.
//
// experimentId read via useParams() (next/navigation) - the same pattern
// already established by app/dashboard/algo-test-library/[strategyId]/page.tsx,
// never window.location-based parsing (that workaround is specifically
// for API ROUTE handlers, whose RouteHandler type has no params argument -
// a page component always has real params via useParams()).
//
// This is NOT passive status polling - continueOptimizationExperiment()
// performs a real, bounded (8s server-side) chunk of actual work each
// call. The loop is: initial GET -> (if non-terminal) continue()
// immediately -> apply the real response -> wait >=1000ms -> continue()
// again -> ... -> terminal. Never framed as a background worker; this UI
// is what drives execution forward.
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Badge, { type BadgeTone } from "@/components/ui/Badge";
import Skeleton from "@/components/ui/Skeleton";
import ErrorState from "@/components/ui/ErrorState";
import Alert from "@/components/ui/Alert";
import Button from "@/components/ui/Button";
import { FIN_LABEL } from "@/components/ui/financial-typography";
import { fetchOptimizationExperiment, continueOptimizationExperiment, OptimizationClientError } from "@/lib/algo-test/optimization-store";
import type { OptimizationExperimentStatus, OptimizationExperimentView } from "@/types/optimization";

// P4.9-A.4-T2-R1 lock #1 - the minimum floor between consecutive
// continue() calls, measured from response to next request. The FIRST
// continue() after the initial GET fires with no floor (immediately) -
// this constant only governs subsequent calls, inside runContinue's own
// scheduling below.
const CONTINUE_POLL_FLOOR_MS = 1000;

function isTerminalStatus(status: string): status is "COMPLETED" | "FAILED" | "CANCELLED" {
  // Generic check (P4.9-A.4-T2-R1 lock #10) - a future CANCELLED (added in
  // its own later tier) already stops this loop with zero changes here.
  return status === "COMPLETED" || status === "FAILED" || status === "CANCELLED";
}

const STATUS_TONE: Readonly<Record<OptimizationExperimentStatus, BadgeTone>> = {
  QUEUED: "neutral",
  RUNNING: "info",
  COMPLETED: "success",
  FAILED: "danger",
  CANCELLED: "warning",
};

export default function AlgoTestOptimizeMonitorPage() {
  const params = useParams<{ experimentId: string }>();
  const experimentId = decodeURIComponent(params.experimentId);

  const [view, setView] = useState<OptimizationExperimentView | null | undefined>(null);
  const [continueError, setContinueError] = useState<OptimizationClientError | null>(null);

  const cancelledRef = useRef(false);
  const inFlightRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Holds the latest runContinue - the scheduled setTimeout below calls
  // through this ref rather than closing over `runContinue` directly, so
  // the recursive self-reference never trips react-hooks' immutability
  // check (a real correctness property, not just linter-appeasement: it
  // guarantees the scheduled call always uses the current experimentId's
  // closure, never a stale one from a prior render).
  const runContinueRef = useRef<() => void>(() => {});

  // P4.9-A.4-T2-R1 lock #6/#7/#8 - ref-based in-flight guard (never state,
  // to avoid stale-closure races in this async loop), the experimentId
  // stale-response guard (the exact `cancelled` flag convention already
  // established by AlgoTestPanel.tsx's/the Strategy Library detail page's
  // own mount effects), and explicit timer cleanup on unmount.
  const runContinue = useCallback(async () => {
    if (cancelledRef.current || inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const result = await continueOptimizationExperiment(experimentId);
      inFlightRef.current = false;
      if (cancelledRef.current) return;
      setView(result);
      setContinueError(null);
      if (!isTerminalStatus(result.status)) {
        timeoutRef.current = setTimeout(() => runContinueRef.current(), CONTINUE_POLL_FLOOR_MS);
      }
    } catch (err) {
      inFlightRef.current = false;
      if (cancelledRef.current) return;
      // P4.9-A.4-T2-R1 lock #9 - stop automatic polling on ANY continue()
      // failure (PROVIDER_ERROR most notably), preserve the real server
      // message, offer manual Retry. Never an automatic retry loop.
      setContinueError(err instanceof OptimizationClientError ? err : new OptimizationClientError("UNKNOWN", err instanceof Error ? err.message : "Failed to continue the optimization."));
    }
  }, [experimentId]);

  useEffect(() => {
    runContinueRef.current = runContinue;
  }, [runContinue]);

  useEffect(() => {
    cancelledRef.current = false;
    inFlightRef.current = false;
    // P4.9-A4-UI-CONTRACT.md's own locked stale-state guard, extended to
    // this async loop: reset on experimentId change before refetching -
    // the exact bug class P4.8-T3.4.2 found and fixed on the Strategy
    // Library detail page.
    setView(null);
    setContinueError(null);

    // P4.9-A.4-T2-R1 lock #2 - the initial GET always happens before any
    // continue() call, covering a fresh load, a refresh, and a
    // bookmarked/shared URL alike.
    fetchOptimizationExperiment(experimentId).then((fetched) => {
      if (cancelledRef.current) return;
      if (!fetched) {
        setView(undefined);
        return;
      }
      setView(fetched);
      // Lock #3/#4 - QUEUED and RUNNING both trigger the loop; a terminal
      // initial state never calls continue() at all.
      if (!isTerminalStatus(fetched.status)) {
        runContinue();
      }
    });

    return () => {
      cancelledRef.current = true;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [experimentId, runContinue]);

  function handleRetry() {
    setContinueError(null);
    runContinue();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/dashboard/algo-test-optimize" className="text-xs text-text-3 hover:text-gold">
        ← Optimize Parameters
      </Link>

      {view === null ? (
        <div className="space-y-3">
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : view === undefined ? (
        <ErrorState title="Optimization experiment not found." description="It may not exist, or it may belong to someone else." />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-2xl font-bold text-text">Optimization</h1>
            <Badge tone={STATUS_TONE[view.status]}>{view.status}</Badge>
          </div>

          <div className="rounded-card border border-border bg-ink-2 p-5">
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className={FIN_LABEL}>Strategy</dt>
                <dd className="mt-0.5 text-text">{view.strategyId}</dd>
              </div>
              <div>
                <dt className={FIN_LABEL}>Symbol / Timeframe</dt>
                <dd className="mt-0.5 text-text">
                  {view.symbol} · {view.timeframe}
                </dd>
              </div>
              <div>
                <dt className={FIN_LABEL}>Date range</dt>
                <dd className="mt-0.5 text-text">
                  {view.startTime.slice(0, 10)} – {view.endTime.slice(0, 10)}
                </dd>
              </div>
            </dl>
          </div>

          {!isTerminalStatus(view.status) ? (
            <div className="rounded-card border border-border bg-ink-2 p-5">
              <p className={FIN_LABEL}>Progress</p>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-ink-3">
                <div
                  className="h-full rounded-full bg-gold transition-[width]"
                  style={{ width: `${view.totalCandidates > 0 ? Math.min(100, (view.processedCandidates / view.totalCandidates) * 100) : 0}%` }}
                />
              </div>
              <p className="mt-2 text-sm text-text-2">
                {view.processedCandidates} / {view.totalCandidates} candidates processed
              </p>
            </div>
          ) : (
            <div className="rounded-card border border-border bg-ink-2 p-5">
              <p className="text-sm text-text-2">
                This experiment finished — {view.processedCandidates}/{view.totalCandidates} candidates processed. Detailed results are not yet available in this build.
              </p>
              {view.status === "FAILED" && view.errorMessage && <p className="mt-2 text-sm text-danger">{view.errorMessage}</p>}
            </div>
          )}

          {continueError && (
            <Alert tone="danger" title="Could not continue the optimization">
              <p>{continueError.message}</p>
              <div className="mt-3">
                <Button variant="danger" size="sm" onClick={handleRetry}>
                  Retry
                </Button>
              </div>
            </Alert>
          )}
        </div>
      )}
    </div>
  );
}
