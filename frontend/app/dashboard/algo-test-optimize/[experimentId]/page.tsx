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
// one extra GET. Locked: "Best Candidate" label (never "Validated
// Strategy" - COMPLETED means a single in-sample sweep finished, not that
// the winner passed any out-of-sample or walk-forward validation), Profit
// Factor + Trade Count only (nothing else is persisted on a candidate),
// full resolved parameterValues with registry-label lookup (raw id
// fallback).
//
// A.4-T5's own locked contract - the read-only candidate EVIDENCE table
// (never an "analysis engine"): answers "what happened to each candidate
// the server actually processed," never "which one do I think is best" -
// that second question stays exclusively `view.bestCandidateId`'s answer,
// same as T4. `winnerDetail`'s own fetch trigger is broadened here from
// "COMPLETED with a winner" to "any terminal status" (COMPLETED/FAILED/
// CANCELLED all get real candidate evidence, per the locked contract) -
// still exactly one GET, still fired exactly once, the SAME response now
// serves both the winner card and the candidate table. Table columns are
// the SWEPT parameters only (`winnerDetail.searchSpace`), never the full
// resolved set (that stays the winner card's own job) - showing every
// declared-but-unswept parameter as a column would repeat the same
// constant value on every one of up to 256 rows, pure noise. No
// pagination (matches components/quant-lite/TradeTable.tsx's own
// established convention - every row, one scrollable Table shell, no new
// UI infrastructure this codebase doesn't already have). Winner-integrity
// lock (computeWinnerIntegrity(), shared by the T4 Best Candidate card
// AND the T5 table): a winner is presented ONLY when the row
// `view.bestCandidateId` points at genuinely carries `status ===
// "VALIDATED"`. On any mismatch the Best Candidate card is suppressed,
// no table row gets the winner marker, and the table's inconsistency
// warning is the single authoritative signal - the UI never
// simultaneously claims "this is the winner" and "we cannot verify the
// winner". Structurally the two always agree (finalizeIfComplete()'s own
// transactional invariant), but this component never assumes that holds
// forever, never infers which side is right, and never touches
// finalizeIfComplete() or any server-side selection. It also never
// creates an informal "best so far" for CANCELLED/FAILED experiments
// (which never have a VALIDATED candidate at all, per T3's own locked
// cancel semantics - no winner validation ever runs on cancellation).
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Badge, { type BadgeTone } from "@/components/ui/Badge";
import Skeleton from "@/components/ui/Skeleton";
import ErrorState from "@/components/ui/ErrorState";
import Alert from "@/components/ui/Alert";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/ui/Table";
import { FIN_LABEL } from "@/components/ui/financial-typography";
import { fetchOptimizationExperiment, continueOptimizationExperiment, cancelOptimizationExperiment, OptimizationClientError } from "@/lib/algo-test/optimization-store";
import { fetchAlgoTestStrategies } from "@/lib/algo-test/store";
import type { OptimizationCandidateStatus, OptimizationCandidateView, OptimizationExperimentStatus, OptimizationExperimentView, OptimizationExperimentDetailView, OptimizationProfitFactor } from "@/types/optimization";
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

// A.4-T5 lock - per-candidate-row status tone. "COMPLETED" is a real
// member of OptimizationCandidateStatus but is structurally unreachable
// today (optimization.service.ts's own CandidateExecutionStatus - the
// only type any execution path ever assigns - is exactly "FAILED" |
// "REJECTED" | "CANDIDATE"; VALIDATED is reachable only via
// finalizeIfComplete()). Still covered here (exhaustive Record, never a
// runtime fallback-to-undefined) so an unexpected value never crashes the
// table, without any dedicated visual investment in a state nothing ever
// produces. VALIDATED's own "gold" tone is its real, honest status -
// independent of the winner-integrity check below, which controls the
// SEPARATE winner highlight/marker, never this badge's tone.
const CANDIDATE_STATUS_TONE: Readonly<Record<OptimizationCandidateStatus, BadgeTone>> = {
  UNRUN: "neutral",
  RUNNING: "info",
  COMPLETED: "neutral",
  REJECTED: "warning",
  CANDIDATE: "neutral",
  VALIDATED: "gold",
  FAILED: "danger",
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

// A.4-T5 lock - the one winner-integrity check, shared by BOTH the T4
// Best Candidate card and the T5 candidate table so the two surfaces can
// never disagree (one saying "here is the winner" while the other says
// "cannot verify the winner"). A winner is presented ONLY when the row
// `view.bestCandidateId` points at genuinely carries `status ===
// "VALIDATED"`. `winnerMismatch` is true whenever that is not the case -
// including when bestCandidateId points at no row at all, or at a
// non-VALIDATED row, or when a VALIDATED row exists under a different id,
// or when a VALIDATED row exists but bestCandidateId is null. On a
// mismatch: the Best Candidate card is suppressed, no table row gets the
// winner marker, and the table's own inconsistency warning becomes the
// single authoritative signal. Never infers which side is "right"; never
// touches finalizeIfComplete() or any server-side selection - this is
// purely the presentation boundary the T5 integrity contract implies.
function computeWinnerIntegrity(detail: OptimizationExperimentDetailView, bestCandidateId: string | null | undefined): { winnerMismatch: boolean; confirmedWinnerId: string | null } {
  const validatedRow = detail.candidates.find((c) => c.status === "VALIDATED");
  const normalizedBestId = bestCandidateId ?? null;
  const winnerMismatch = (validatedRow?.id ?? null) !== normalizedBestId;
  return { winnerMismatch, confirmedWinnerId: winnerMismatch ? null : normalizedBestId };
}

// A.4-T5 lock - one candidate table row. A plain module-level component
// (no closure over page state - every value it needs arrives as a prop)
// so the parent's own renderCandidateEvidence() stays a thin loop, not a
// growing inline JSX block. The status badge's tone/text is always the
// candidate's own real `status` (passive rendering, per the locked "never
// presents a computed opinion" rule) - `isConfirmedWinner` (already
// resolved by the caller's own integrity check) only ever ADDS a small
// separate winner marker + row tint, it never changes the badge itself.
function CandidateRow({ candidate, sweptParameterIds, minEligibleTrades, isConfirmedWinner }: { candidate: OptimizationCandidateView; sweptParameterIds: readonly string[]; minEligibleTrades: number; isConfirmedWinner: boolean }) {
  const note = candidate.status === "REJECTED" ? `Below the ${minEligibleTrades}-trade minimum` : candidate.status === "FAILED" && candidate.errorMessage ? candidate.errorMessage : "—";
  return (
    <Tr className={isConfirmedWinner ? "bg-gold/5" : undefined}>
      <Td>
        <span className="inline-flex items-center gap-2">
          <Badge tone={CANDIDATE_STATUS_TONE[candidate.status]}>{candidate.status}</Badge>
          {isConfirmedWinner && (
            <span className="text-xs font-semibold text-gold" title="Server-designated winner">
              ★ Winner
            </span>
          )}
        </span>
      </Td>
      {sweptParameterIds.map((parameterId) => (
        <Td key={parameterId}>{String(candidate.parameterValues[parameterId] ?? "—")}</Td>
      ))}
      <Td>{formatOptimizationProfitFactor(candidate.profitFactor)}</Td>
      <Td>{candidate.tradeCount ?? "—"}</Td>
      <Td>{note}</Td>
    </Tr>
  );
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

  // A.4-T5 lock - fires exactly once per terminal transition (guarded by
  // winnerFetchStartedRef), broadened from T4's own "COMPLETED with a
  // winner" to ANY terminal status - COMPLETED (winner or not), FAILED,
  // and CANCELLED all get real candidate evidence now. Still one fetch;
  // the same response feeds both the winner card (COMPLETED branch) and
  // the candidate table (every terminal branch). Also usable as a manual
  // Retry.
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
    // parameter LABELS (the winner card's full set, and the candidate
    // table's swept-only columns) - no new backend surface.
    fetchAlgoTestStrategies().then((strategies) => {
      if (cancelledRef.current) return;
      setStrategyDef(strategies.find((s) => s.strategyId === view?.strategyId));
    });
  }, [experimentId, view?.strategyId]);

  useEffect(() => {
    if (!view || !isTerminalStatus(view.status)) return;
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

  // A.4-T5 lock - the one candidate-evidence renderer, shared by every
  // terminal branch (COMPLETED/FAILED/CANCELLED) below - never a second
  // copy. Mirrors winnerDetail's own null/undefined/object states exactly
  // (pending skeleton / failed-with-Retry / real table) so every terminal
  // branch gets the same honest loading/error behavior the winner card
  // already has, not just COMPLETED.
  function renderCandidateEvidence(view: OptimizationExperimentView) {
    if (winnerDetail === null) {
      return (
        <div className="mt-4 space-y-2">
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-32 w-full" />
        </div>
      );
    }
    if (winnerDetail === undefined) {
      return (
        <div className="mt-3">
          <Alert tone="danger" title="Could not load candidate results">
            <p>The optimization finished, but its candidate results could not be loaded.</p>
            <div className="mt-3">
              <Button variant="danger" size="sm" onClick={loadWinnerDetail}>
                Retry
              </Button>
            </div>
          </Alert>
        </div>
      );
    }

    const candidates = winnerDetail.candidates;
    // Defensive only - computeTotalCandidates() never resolves to 0 (an
    // empty searchSpace still yields the single degenerate candidate), so
    // this is not a real product state, just a guard against ever
    // assuming that invariant holds forever.
    if (candidates.length === 0) return null;

    // A.4-T5 lock - swept parameters ONLY (experiment.searchSpace), never
    // the full resolved parameterValues set (that stays the winner card's
    // own job) - showing every declared-but-unswept parameter as a column
    // would repeat the same constant value on every one of up to 256 rows.
    const sweptParameterIds = winnerDetail.searchSpace.map((range) => range.parameterId);

    // A.4-T5 lock - the winner-integrity check (shared with the Best
    // Candidate card above via computeWinnerIntegrity()). A row is the
    // CONFIRMED winner only when its own real status is VALIDATED AND its
    // id matches view.bestCandidateId. Structurally these always agree
    // (finalizeIfComplete()'s own transactional invariant), but that is
    // never assumed to hold forever: a disagreement renders as a
    // defensive warning here, the Best Candidate card is suppressed, and
    // no row is highlighted - never a silently guessed resolution.
    const { winnerMismatch, confirmedWinnerId } = computeWinnerIntegrity(winnerDetail, view.bestCandidateId);

    return (
      <div className="mt-4 border-t border-border pt-4">
        <p className={FIN_LABEL}>Candidates</p>

        {winnerMismatch && (
          <div className="mt-2">
            <Alert tone="warning" title="Winner data inconsistency detected">
              <p>The server-designated winner does not match the candidate marked VALIDATED. No candidate is shown as the winner until this is resolved.</p>
            </Alert>
          </div>
        )}

        <div className="mt-2">
          <Table>
            <Thead>
              <Tr>
                <Th>Status</Th>
                {sweptParameterIds.map((parameterId) => (
                  <Th key={parameterId}>{parameterLabel(parameterId)}</Th>
                ))}
                <Th>Profit Factor</Th>
                <Th>Trades</Th>
                <Th>Notes</Th>
              </Tr>
            </Thead>
            <Tbody>
              {candidates.map((candidate) => (
                <CandidateRow key={candidate.id} candidate={candidate} sweptParameterIds={sweptParameterIds} minEligibleTrades={view.minEligibleTrades} isConfirmedWinner={candidate.id === confirmedWinnerId} />
              ))}
            </Tbody>
          </Table>
        </div>
      </div>
    );
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
              {renderCandidateEvidence(view)}
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
                // A.4-T5 - the fetch failure itself is now reported once,
                // by renderCandidateEvidence() below (the SAME fetch, the
                // SAME Retry action) - no duplicate Alert here.
                null
              ) : (
                (() => {
                  // A.4-T5 lock - the Best Candidate card is gated on the
                  // SAME winner-integrity check the candidate table uses.
                  // On any mismatch (bestCandidateId points at no row, a
                  // non-VALIDATED row, or a different id than the VALIDATED
                  // row) the card is suppressed entirely - the table's own
                  // "Winner data inconsistency detected" warning below is
                  // then the single authoritative signal, and the UI never
                  // simultaneously claims "this is the winner" and "we
                  // cannot verify the winner".
                  const { winnerMismatch } = computeWinnerIntegrity(winnerDetail, view.bestCandidateId);
                  const winner = winnerDetail.candidates.find((c) => c.id === view.bestCandidateId);
                  if (winnerMismatch || !winner) return null;
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
              {/* A.4-T5 lock - the candidate table renders regardless of the
                  branch above (winner, no-winner, still-loading, or
                  failed-to-load) - it is driven by the same winnerDetail
                  fetch but is otherwise independent of the winner card. */}
              {renderCandidateEvidence(view)}
            </div>
          ) : (
            <div className="rounded-card border border-border bg-ink-2 p-5">
              <p className="text-sm text-text-2">
                This experiment finished — {view.processedCandidates}/{view.totalCandidates} candidates processed.
              </p>
              {view.status === "FAILED" && view.errorMessage && <p className="mt-2 text-sm text-danger">{view.errorMessage}</p>}
              {renderCandidateEvidence(view)}
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
