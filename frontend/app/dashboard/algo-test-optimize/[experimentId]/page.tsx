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
//
// A.4-T4's own locked contract (docs/P4.9-OPTIMIZATION-WFO.md) - the
// COMPLETED branch below. The winner is ALWAYS `view.bestCandidateId`
// (set server-side, inside the same transaction as the COMPLETED write -
// see optimization.service.ts's finalizeIfComplete()); this component
// NEVER recomputes a winner from candidate data, it only looks one up by
// that id. `view` itself (from the polling loop / initial GET / cancel())
// already carries bestCandidateId (it's on the lightweight
// OptimizationExperimentView shape) - so a null bestCandidateId (the "all
// candidates rejected" edge state) is known immediately, no extra fetch
// needed. A non-null bestCandidateId means a winner exists but its
// metrics/parameters only exist on the DETAIL shape (candidates[] is
// detail-only, per types/optimization.ts) - `winnerDetail` below is that
// one extra GET, fired exactly once, only in that case. Locked: "Best
// Candidate" label (never "Validated Strategy" - COMPLETED means a single
// in-sample sweep finished, not that the winner passed any out-of-sample
// or walk-forward validation), Profit Factor + Trade Count only (nothing
// else is persisted on a candidate), full resolved parameterValues with
// registry-label lookup (raw id fallback).
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
import { fetchAlgoTestStrategies } from "@/lib/algo-test/store";
import type { OptimizationExperimentStatus, OptimizationExperimentView, OptimizationExperimentDetailView, OptimizationProfitFactor } from "@/types/optimization";
import type { AlgoTestStrategyDefinition } from "@/types/algo-test";

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

// A.4-T4 lock - the wire union's own doc comment (types/optimization.ts)
// spells out why this can't reuse formatPrice()/formatPercent()
// (lib/financial-format.ts): both take a plain `number`, and profit
// factor is deliberately `number | "Infinity" | null` on the wire.
// "Infinity" (a candidate with zero losing trades) displays as the real
// mathematical symbol, never a fabricated finite number; `null` ("not yet
// computed") is only ever seen here for a REJECTED/FAILED/UNRUN candidate
// - a winner (VALIDATED) always has a real computed value - but this
// stays total rather than assuming that invariant holds.
function formatOptimizationProfitFactor(value: OptimizationProfitFactor): string {
  if (value === "Infinity") return "∞";
  if (value === null) return "—";
  return value.toFixed(2);
}

export default function AlgoTestOptimizeMonitorPage() {
  const params = useParams<{ experimentId: string }>();
  const experimentId = decodeURIComponent(params.experimentId);

  const [view, setView] = useState<OptimizationExperimentView | null | undefined>(null);
  const [continueError, setContinueError] = useState<OptimizationClientError | null>(null);
  const [cancelError, setCancelError] = useState<OptimizationClientError | null>(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  // A.4-T4 lock - `null` = pending (fetch not yet resolved), `undefined` =
  // fetched but unavailable (transient failure - fetchOptimizationExperiment()
  // never throws, so this is the only failure shape), object = the real
  // detail (its own candidates[] is where the winner's metrics/parameters
  // live - see the lookup in the COMPLETED render branch below).
  const [winnerDetail, setWinnerDetail] = useState<OptimizationExperimentDetailView | null | undefined>(null);
  // Registry labels only (P3.4's AlgoTestParameterDefinition.label) - a
  // raw-id fallback (see parameterLabel() below) means this is
  // presentation-only and never blocks the winner card from rendering.
  const [strategyDef, setStrategyDef] = useState<AlgoTestStrategyDefinition | null | undefined>(null);

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

  // A.4-T4 lock - fires exactly once (guarded by winnerFetchStartedRef),
  // only once a winner actually exists to look up (a null bestCandidateId
  // - the "all candidates rejected" edge state - never triggers this: the
  // COMPLETED render branch below reads view.minEligibleTrades directly,
  // no fetch required). Also usable as a manual Retry.
  const winnerFetchStartedRef = useRef(false);
  const loadWinnerDetail = useCallback(() => {
    setWinnerDetail(null);
    setStrategyDef(null);
    fetchOptimizationExperiment(experimentId).then((detail) => {
      if (cancelledRef.current) return;
      setWinnerDetail(detail);
    });
    // Reuses the same registry endpoint the create-experiment/run pages
    // already fetch (fetchAlgoTestStrategies() - P3.3/P3.4) purely for
    // this strategy's parameter LABELS - no new backend surface.
    fetchAlgoTestStrategies().then((strategies) => {
      if (cancelledRef.current) return;
      setStrategyDef(strategies.find((s) => s.strategyId === view?.strategyId));
    });
  }, [experimentId, view?.strategyId]);

  useEffect(() => {
    if (!view || view.status !== "COMPLETED" || !view.bestCandidateId) return;
    if (winnerFetchStartedRef.current) return;
    winnerFetchStartedRef.current = true;
    loadWinnerDetail();
  }, [view, loadWinnerDetail]);

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
    winnerFetchStartedRef.current = false;
    setWinnerDetail(null);
    setStrategyDef(null);

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

  // A.4-T4 lock - registry label, raw parameter id fallback (covers
  // strategyDef still pending/undefined/not-yet-matched - never blocks
  // rendering the winner's real parameter values on a slow/failed
  // registry fetch).
  function parameterLabel(parameterId: string): string {
    return strategyDef?.parameters.find((p) => p.id === parameterId)?.label ?? parameterId;
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
          ) : view.status === "COMPLETED" ? (
            <div className="rounded-card border border-border bg-ink-2 p-5">
              <p className="text-sm text-text-2">
                Finished — {view.processedCandidates}/{view.totalCandidates} candidates processed.
              </p>

              {!view.bestCandidateId ? (
                // A.4-T4 lock - the "all candidates rejected" edge state.
                // Copy is sourced from the real view.minEligibleTrades,
                // never a hardcoded number.
                <p className="mt-3 text-sm text-text-2">
                  No candidate produced at least {view.minEligibleTrades} eligible trade{view.minEligibleTrades === 1 ? "" : "s"}, so no best candidate could be selected.
                </p>
              ) : winnerDetail === null ? (
                <div className="mt-4 space-y-2">
                  <Skeleton className="h-5 w-1/3" />
                  <Skeleton className="h-20 w-full" />
                </div>
              ) : winnerDetail === undefined ? (
                <div className="mt-3">
                  <Alert tone="danger" title="Could not load the best candidate">
                    <p>The optimization finished, but its results could not be loaded.</p>
                    <div className="mt-3">
                      <Button variant="danger" size="sm" onClick={loadWinnerDetail}>
                        Retry
                      </Button>
                    </div>
                  </Alert>
                </div>
              ) : (
                (() => {
                  const winner = winnerDetail.candidates.find((c) => c.id === view.bestCandidateId);
                  if (!winner) {
                    return (
                      <div className="mt-3">
                        <Alert tone="danger" title="Could not load the best candidate">
                          <p>The optimization finished, but the best candidate&apos;s details could not be found.</p>
                        </Alert>
                      </div>
                    );
                  }
                  const parameterEntries = Object.entries(winner.parameterValues);
                  return (
                    <div className="mt-4 border-t border-border pt-4">
                      <h2 className="text-base font-semibold text-text">Best Candidate</h2>

                      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                        <div>
                          <dt className={FIN_LABEL}>Profit Factor</dt>
                          <dd className="mt-0.5 text-text">{formatOptimizationProfitFactor(winner.profitFactor)}</dd>
                        </div>
                        <div>
                          <dt className={FIN_LABEL}>Trades</dt>
                          <dd className="mt-0.5 text-text">{winner.tradeCount ?? "—"}</dd>
                        </div>
                      </dl>

                      {parameterEntries.length > 0 && (
                        <div className="mt-4">
                          <p className={FIN_LABEL}>Parameters</p>
                          <dl className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                            {parameterEntries.map(([parameterId, parameterValue]) => (
                              <div key={parameterId} className="flex items-center justify-between rounded bg-ink-3 px-3 py-1.5">
                                <dt className="text-text-3">{parameterLabel(parameterId)}</dt>
                                <dd className="text-text">{String(parameterValue)}</dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                      )}

                      {/* A.4-T4 lock - the anti-overclaim disclaimer. COMPLETED means
                          one in-sample sweep finished, never that the winner passed
                          out-of-sample or walk-forward validation. */}
                      <p className="mt-4 text-xs text-text-3">This reflects a single in-sample parameter sweep, not out-of-sample or walk-forward validation.</p>

                      <div className="mt-4">
                        <Link href={`/dashboard/algo-test-library/${view.strategyId}`} className="text-xs text-gold hover:underline">
                          View Strategy
                        </Link>
                      </div>
                    </div>
                  );
                })()
              )}
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
