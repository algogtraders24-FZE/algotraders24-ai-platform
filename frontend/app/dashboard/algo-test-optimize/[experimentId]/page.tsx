"use client";

// app/dashboard/algo-test-optimize/[experimentId]/page.tsx
// P4.9-A.4-T2/T3 (docs/P4.9-A4-UI-CONTRACT.md, and this tier's own locked
// P4.9-A.4-T2-R1/A.4-T3 contracts) - Monitor + client-driven continuation +
// cancellation. Still no winner/results presentation, no candidate table
// (later tiers). This is also the eventual Results page (one state-driven
// component tree, per the R1 contract's own locked decision #8/route #2) -
// later tiers extend the COMPLETED branch here, they do not replace this
// file.
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
//
// A.4-T3's own locked critical invariant: once a terminal state has been
// applied (from either a continue() response or a cancel() response), no
// LATER-arriving response of either kind may change it back to
// QUEUED/RUNNING/COMPLETED - see applyResult()'s statusRef guard below,
// the real correctness gap this tier's own audit found in T2's original
// unconditional setView(result).
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Badge, { type BadgeTone } from "@/components/ui/Badge";
import Skeleton from "@/components/ui/Skeleton";
import ErrorState from "@/components/ui/ErrorState";
import Alert from "@/components/ui/Alert";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import { FIN_LABEL } from "@/components/ui/financial-typography";
import { fetchOptimizationExperiment, continueOptimizationExperiment, cancelOptimizationExperiment, OptimizationClientError } from "@/lib/algo-test/optimization-store";
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
  const [cancelError, setCancelError] = useState<OptimizationClientError | null>(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const cancelledRef = useRef(false);
  const inFlightRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // P4.9-A.4-T3 lock - the critical invariant guard: tracks the latest
  // status actually applied to `view`. Once terminal, a later-arriving
  // response (from either continue() or cancel() - either can be
  // in-flight when the other resolves) is discarded rather than applied,
  // so a stale continue() response can never resurrect a status the
  // component has already recorded as terminal (e.g. after cancellation).
  const statusRef = useRef<string | undefined>(undefined);
  // P4.9-A.4-T3 lock - set the instant the user confirms cancellation, so
  // no NEW continue() is scheduled or started afterward (an ALREADY
  // in-flight continue() is not aborted - it is allowed to finish
  // naturally, per the locked "chunk-granularity, not instant" semantics -
  // its response just cannot resurrect a terminal state, per statusRef
  // above).
  const cancelRequestedRef = useRef(false);
  // Holds the latest runContinue - the scheduled setTimeout below calls
  // through this ref rather than closing over `runContinue` directly, so
  // the recursive self-reference never trips react-hooks' immutability
  // check (a real correctness property, not just linter-appeasement: it
  // guarantees the scheduled call always uses the current experimentId's
  // closure, never a stale one from a prior render).
  const runContinueRef = useRef<() => void>(() => {});

  // P4.9-A.4-T3 lock - the one place any server response (continue, GET,
  // or cancel) is ever applied to `view`. Enforces the critical invariant
  // above before every write.
  const applyResult = useCallback((result: OptimizationExperimentView) => {
    if (statusRef.current && isTerminalStatus(statusRef.current)) return;
    statusRef.current = result.status;
    setView(result);
  }, []);

  // P4.9-A.4-T2-R1 lock #6/#7/#8 - ref-based in-flight guard (never state,
  // to avoid stale-closure races in this async loop), the experimentId
  // stale-response guard (the exact `cancelled` flag convention already
  // established by AlgoTestPanel.tsx's/the Strategy Library detail page's
  // own mount effects), and explicit timer cleanup on unmount.
  const runContinue = useCallback(async () => {
    if (cancelledRef.current || inFlightRef.current || cancelRequestedRef.current) return;
    inFlightRef.current = true;
    try {
      const result = await continueOptimizationExperiment(experimentId);
      inFlightRef.current = false;
      if (cancelledRef.current) return;
      applyResult(result);
      setContinueError(null);
      // A prior cancel() attempt may have failed and left its own error
      // banner up (handleCancelConfirm resumes the loop on that failure -
      // see below) - once continuation genuinely succeeds again, that
      // stale cancel-failure banner is no longer accurate and must clear
      // too, not just continueError. Found via live testing, not assumed.
      setCancelError(null);
      if (!isTerminalStatus(result.status) && !cancelRequestedRef.current) {
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
  }, [experimentId, applyResult]);

  useEffect(() => {
    runContinueRef.current = runContinue;
  }, [runContinue]);

  useEffect(() => {
    cancelledRef.current = false;
    inFlightRef.current = false;
    cancelRequestedRef.current = false;
    statusRef.current = undefined;
    // P4.9-A4-UI-CONTRACT.md's own locked stale-state guard, extended to
    // this async loop: reset on experimentId change before refetching -
    // the exact bug class P4.8-T3.4.2 found and fixed on the Strategy
    // Library detail page.
    setView(null);
    setContinueError(null);
    setCancelError(null);
    setShowCancelModal(false);
    setCancelling(false);

    // P4.9-A.4-T2-R1 lock #2 - the initial GET always happens before any
    // continue() call, covering a fresh load, a refresh, and a
    // bookmarked/shared URL alike.
    fetchOptimizationExperiment(experimentId).then((fetched) => {
      if (cancelledRef.current) return;
      if (!fetched) {
        setView(undefined);
        return;
      }
      applyResult(fetched);
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
  }, [experimentId, runContinue, applyResult]);

  function handleRetry() {
    setContinueError(null);
    runContinue();
  }

  function handleCancelClick() {
    setShowCancelModal(true);
  }

  async function handleCancelConfirm() {
    setShowCancelModal(false);
    setCancelling(true);
    setCancelError(null);
    // Stop any further continuation immediately - the ALREADY in-flight
    // continue() (if any) is not aborted, it finishes naturally per the
    // locked chunk-granularity semantics; this only prevents a NEW one
    // from starting.
    cancelRequestedRef.current = true;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    try {
      const result = await cancelOptimizationExperiment(experimentId);
      if (cancelledRef.current) return;
      applyResult(result);
    } catch (err) {
      if (cancelledRef.current) return;
      setCancelError(err instanceof OptimizationClientError ? err : new OptimizationClientError("UNKNOWN", err instanceof Error ? err.message : "Failed to cancel the optimization."));
      // The cancel request itself failed - the experiment is presumably
      // still QUEUED/RUNNING server-side (never assumed cancelled just
      // because the client wanted it to be). Un-pause continuation rather
      // than leaving the UI stuck.
      cancelRequestedRef.current = false;
      runContinueRef.current();
    } finally {
      if (!cancelledRef.current) setCancelling(false);
    }
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
              <div className="mt-4">
                <Button variant="danger" size="sm" onClick={handleCancelClick} loading={cancelling}>
                  Cancel Optimization
                </Button>
              </div>
            </div>
          ) : view.status === "CANCELLED" ? (
            <div className="rounded-card border border-border bg-ink-2 p-5">
              <p className="text-sm text-text-2">
                Cancelled — {view.processedCandidates}/{view.totalCandidates} candidates processed before cancellation.
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

          {cancelError && (
            <Alert tone="danger" title="Could not cancel the optimization">
              <p>{cancelError.message}</p>
            </Alert>
          )}
        </div>
      )}

      <Modal open={showCancelModal} onClose={() => setShowCancelModal(false)} title="Cancel optimization?">
        <p className="text-sm text-text-2">The current candidate will finish before the optimization stops. Unprocessed candidates will not be executed.</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setShowCancelModal(false)}>
            Keep running
          </Button>
          <Button variant="danger" size="sm" onClick={handleCancelConfirm}>
            Cancel optimization
          </Button>
        </div>
      </Modal>
    </div>
  );
}
