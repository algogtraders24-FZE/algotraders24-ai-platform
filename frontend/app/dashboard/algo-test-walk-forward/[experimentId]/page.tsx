"use client";

// app/dashboard/algo-test-walk-forward/[experimentId]/page.tsx
// P4.9-C.2 - Walk-Forward Monitor. Adapted directly from
// app/dashboard/algo-test-optimize/[experimentId]/page.tsx (P4.9-A.4-T2/
// T3/T4/T5) - same client-driven continuation loop, same terminal-state
// invariant guard, same cancellation UX, same never-fabricate-a-value
// discipline. Presentation is adapted to the WFO hierarchy
// (experiment -> fold -> candidate, plus a process verdict distinct from
// status), per the locked P4.9-B-R2 contract this program has enforced
// since B.
//
// experimentId read via useParams(), same convention as the Optimization
// Monitor page and the Strategy Library detail page.
//
// ONE deliberate architectural adaptation from the Optimization page,
// disclosed here rather than silently copied: continueWalkForwardExperiment()
// (unlike continueOptimizationExperiment()) returns only the lightweight
// WalkForwardExperimentView - no folds. Optimization's own polling loop
// never needed fold-equivalent detail until the very end (candidates[] is
// fetched once, via a SEPARATE winnerDetail effect, only after a terminal
// status). WFO's "Fold-level evidence" requirement is part of the PRIMARY
// monitor experience, not a terminal-only extra - a user watching a
// RUNNING experiment needs to see which fold is active and what its
// candidates are doing right now. So this page keeps ONE state object
// (`detail`, the full WalkForwardExperimentDetailView) and re-fetches it
// via fetchWalkForwardExperiment() (GET) after every continue()/cancel()
// call, rather than splitting a lightweight polling `view` from a
// separate one-shot `winnerDetail` the way Optimization does. The
// terminal-state invariant guard (never let a stale response resurrect a
// terminal status) is preserved exactly - applyResult() still gates every
// write through the same statusRef check. If the follow-up GET itself
// fails (fetchWalkForwardExperiment() never throws - it returns
// undefined), the mutation's own real response (status/verdict/fold
// counts) is merged onto the last known-good detail rather than either
// discarding real backend data or fabricating anything - every field in
// that merge is a value the backend genuinely returned, on one call or
// the other, never computed here.
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
import { fetchWalkForwardExperiment, continueWalkForwardExperiment, cancelWalkForwardExperiment, WalkForwardClientError } from "@/lib/algo-test/walk-forward-store";
import type {
  WalkForwardCandidateStatus,
  WalkForwardCandidateView,
  WalkForwardExperimentStatus,
  WalkForwardExperimentDetailView,
  WalkForwardExperimentView,
  WalkForwardFoldDetailView,
  WalkForwardFoldStatus,
  WalkForwardOosOutcome,
  WalkForwardVerdict,
  WalkForwardParameterRange,
} from "@/types/walk-forward";
import type { OptimizationProfitFactor } from "@/types/optimization";

// Same floor Optimization's own Monitor page locks (P4.9-A.4-T2-R1 #1) -
// the minimum time between consecutive continue() calls, measured from
// response to next request.
const CONTINUE_POLL_FLOOR_MS = 1000;

// Exported (P4.9-C.2 - smallest justified change, same reuse-for-testability
// precedent as B.3's own expandCandidateParameterValues export): this repo
// has no DOM/React renderer for a validator script to drive, so the
// C.2 UI validator exercises these pure functions directly instead of only
// reading page source as text.
export function isTerminalStatus(status: string): status is "COMPLETED" | "FAILED" | "CANCELLED" {
  return status === "COMPLETED" || status === "FAILED" || status === "CANCELLED";
}

const STATUS_TONE: Readonly<Record<WalkForwardExperimentStatus, BadgeTone>> = {
  QUEUED: "neutral",
  RUNNING: "info",
  COMPLETED: "success",
  FAILED: "danger",
  CANCELLED: "warning",
};

// Deliberately its own presentation, distinct from STATUS_TONE (P4.9-C.2
// lock, per the sprint's own §7 rule) - a status Badge answers "what is
// the experiment doing", a verdict Badge answers "what did the evidence
// conclude". The two must never share a color mapping that could make a
// COMPLETED status look like an endorsement on its own.
const VERDICT_TONE: Readonly<Record<WalkForwardVerdict, BadgeTone>> = {
  PASSED: "success",
  FAILED: "danger",
  INCONCLUSIVE: "warning",
};

const FOLD_STATUS_TONE: Readonly<Record<WalkForwardFoldStatus, BadgeTone>> = {
  UNRUN: "neutral",
  OPTIMIZING: "info",
  VALIDATING: "info",
  COMPLETED: "success",
  FAILED: "danger",
};

// Same literal vocabulary as Optimization's own CANDIDATE_STATUS_TONE
// (types/walk-forward.ts's own doc comment: WalkForwardCandidateStatus is
// deliberately the same string union) - duplicated here rather than
// imported, matching this whole program's established "deliberately
// separate, even where identical" convention.
const CANDIDATE_STATUS_TONE: Readonly<Record<WalkForwardCandidateStatus, BadgeTone>> = {
  UNRUN: "neutral",
  RUNNING: "info",
  COMPLETED: "neutral",
  REJECTED: "warning",
  CANDIDATE: "neutral",
  VALIDATED: "gold",
  FAILED: "danger",
};

const OOS_OUTCOME_TONE: Readonly<Record<WalkForwardOosOutcome, BadgeTone>> = {
  PASSED: "success",
  FAILED: "danger",
  INCONCLUSIVE: "warning",
};

// Identical formatter to Optimization's own formatOptimizationProfitFactor()
// - both operate on the SAME wire type (OptimizationProfitFactor is
// imported directly by types/walk-forward.ts, not redefined), so this is
// not a coincidental duplicate, it is the same value shape. Duplicated
// (not imported from the Optimization page, which is explicitly untouched
// per this sprint's own scope) rather than extracted into a shared module
// - a two-line pure function is not worth a cross-file dependency here.
export function formatProfitFactor(value: OptimizationProfitFactor): string {
  if (value === "Infinity") return "∞";
  if (value === null) return "—";
  return value.toFixed(2);
}

function formatDateOnly(iso: string): string {
  return iso.slice(0, 10);
}

function formatWindow(startIso: string, endIso: string): string {
  return `${iso8601ToDisplay(startIso)} → ${iso8601ToDisplay(endIso)}`;
}

function iso8601ToDisplay(iso: string): string {
  // Fold windows can differ by minutes (the locked IS/OOS boundary is one
  // bar-interval apart, not a full day) - date-only would make two
  // genuinely different boundaries look identical, so this keeps time.
  return iso.slice(0, 16).replace("T", " ");
}

// P4.9-C.2 lock - the load-bearing no-winner/INCONCLUSIVE case (sprint
// §10). A fold that reached COMPLETED with no winner never ran OOS at
// all (P4.9-B-B.2.1's own locked shape: winnerCandidateId/oosProfitFactor/
// oosTradeCount all null, oosOutcome always "INCONCLUSIVE"). This is
// checked structurally against the real persisted fields, never inferred
// from "oosOutcome === INCONCLUSIVE" alone (a fold COULD reach
// INCONCLUSIVE via genuine OOS validation with too few trades, which DID
// run and has a real - if unpersuasive - oosProfitFactor; that is a
// different, still-real case and must not be described as "no winner").
export function isNoWinnerCompletion(fold: WalkForwardFoldDetailView): boolean {
  return fold.status === "COMPLETED" && fold.winnerCandidateId === null && fold.oosProfitFactor === null && fold.oosTradeCount === null;
}

// Merges a real mutation response (continue/cancel's own lightweight
// WalkForwardExperimentView) onto the last known-good full detail, used
// ONLY when the follow-up GET after a mutation itself fails - every field
// in the result is either the mutation's own real response or the prior
// real GET response, never fabricated. A pure function of its two
// arguments only (no closure over component state), so it needs no
// dependency-array entry wherever it's called from inside a useCallback.
export function mergeSummary(previous: WalkForwardExperimentDetailView | null | undefined, summary: WalkForwardExperimentView): WalkForwardExperimentDetailView | undefined {
  if (!previous) return undefined;
  return { ...previous, ...summary };
}

// One candidate row within its owning fold's own table. A plain
// module-level component (no closure over page state), mirrors
// Optimization's own CandidateRow exactly in shape.
function WalkForwardCandidateRow({ candidate, sweptParameterIds, isWinner }: { candidate: WalkForwardCandidateView; sweptParameterIds: readonly string[]; isWinner: boolean }) {
  const note = candidate.status === "REJECTED" ? "Below the eligible-trade minimum" : candidate.status === "FAILED" && candidate.errorMessage ? candidate.errorMessage : "—";
  return (
    <Tr className={isWinner ? "bg-gold/5" : undefined}>
      <Td>
        <span className="inline-flex items-center gap-2">
          <Badge tone={CANDIDATE_STATUS_TONE[candidate.status]}>{candidate.status}</Badge>
          {isWinner && (
            <span className="text-xs font-semibold text-gold" title="Fold-local winner (in-sample)">
              ★ Fold Winner
            </span>
          )}
        </span>
      </Td>
      {sweptParameterIds.map((parameterId) => (
        <Td key={parameterId}>{String(candidate.parameterValues[parameterId] ?? "—")}</Td>
      ))}
      <Td>{formatProfitFactor(candidate.profitFactor)}</Td>
      <Td>{candidate.tradeCount ?? "—"}</Td>
      <Td>{note}</Td>
    </Tr>
  );
}

// One fold's own section: window/status header, OOS result (kept visually
// and structurally SEPARATE from any candidate's own in-sample metrics -
// sprint §7/§20's "clear distinction between IS and OOS" and "candidate
// metrics vs process verdict" rules, applied one level down to
// winner-candidate-IS-metrics vs fold-OOS-metrics), then this fold's own
// candidate table nested beneath it (never flattened into one global
// table - sprint §11, there is no global WFO winner).
function FoldSection({ fold, searchSpace }: { fold: WalkForwardFoldDetailView; searchSpace: readonly WalkForwardParameterRange[] }) {
  const sweptParameterIds = searchSpace.map((range) => range.parameterId);
  const winner = fold.winnerCandidateId ? fold.candidates.find((c) => c.id === fold.winnerCandidateId) : undefined;
  const noWinner = isNoWinnerCompletion(fold);

  return (
    <div className="rounded-card border border-border bg-ink-2 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text">Fold {fold.foldIndex + 1}</h3>
        <Badge tone={FOLD_STATUS_TONE[fold.status]}>{fold.status}</Badge>
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className={FIN_LABEL}>In-sample window</dt>
          <dd className="mt-0.5 text-text-2">{formatWindow(fold.inSampleStart, fold.inSampleEnd)}</dd>
        </div>
        <div>
          <dt className={FIN_LABEL}>Out-of-sample window</dt>
          <dd className="mt-0.5 text-text-2">{formatWindow(fold.outOfSampleStart, fold.outOfSampleEnd)}</dd>
        </div>
      </dl>

      <div className="mt-4 border-t border-border pt-4">
        <p className={FIN_LABEL}>Out-of-sample validation</p>
        {noWinner ? (
          <p className="mt-2 text-sm text-text-2">No eligible winner was produced for this fold; out-of-sample validation was not run.</p>
        ) : (
          <dl className="mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-text-3">Winner (in-sample)</dt>
              <dd className="mt-0.5 text-text">{winner ? `PF ${formatProfitFactor(winner.profitFactor)} (IS)` : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-text-3">OOS Profit Factor</dt>
              <dd className="mt-0.5 text-text">{formatProfitFactor(fold.oosProfitFactor)}</dd>
            </div>
            <div>
              <dt className="text-xs text-text-3">OOS Trades</dt>
              <dd className="mt-0.5 text-text">{fold.oosTradeCount ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-text-3">OOS Outcome</dt>
              <dd className="mt-0.5">{fold.oosOutcome ? <Badge tone={OOS_OUTCOME_TONE[fold.oosOutcome]}>{fold.oosOutcome}</Badge> : <span className="text-text">—</span>}</dd>
            </div>
          </dl>
        )}
      </div>

      {fold.candidates.length > 0 && (
        <div className="mt-4 border-t border-border pt-4">
          <p className={FIN_LABEL}>
            Candidates ({fold.candidates.length})
          </p>
          <div className="mt-2">
            <Table>
              <Thead>
                <Tr>
                  <Th>Status</Th>
                  {sweptParameterIds.map((parameterId) => (
                    <Th key={parameterId}>{parameterId}</Th>
                  ))}
                  <Th>IS Profit Factor</Th>
                  <Th>IS Trades</Th>
                  <Th>Notes</Th>
                </Tr>
              </Thead>
              <Tbody>
                {fold.candidates.map((candidate) => (
                  <WalkForwardCandidateRow key={candidate.id} candidate={candidate} sweptParameterIds={sweptParameterIds} isWinner={candidate.id === fold.winnerCandidateId} />
                ))}
              </Tbody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AlgoTestWalkForwardMonitorPage() {
  const params = useParams<{ experimentId: string }>();
  const experimentId = decodeURIComponent(params.experimentId);

  // null = pending (initial fetch not yet resolved), undefined = fetched
  // but unavailable (not found / not owned, or a transient failure -
  // fetchWalkForwardExperiment() never throws, so this is the only
  // failure shape on initial load), object = the real detail.
  const [detail, setDetail] = useState<WalkForwardExperimentDetailView | null | undefined>(null);
  const [continueError, setContinueError] = useState<WalkForwardClientError | null>(null);
  const [cancelError, setCancelError] = useState<WalkForwardClientError | null>(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const cancelledRef = useRef(false);
  const inFlightRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Same P4.9-A.4-T3 critical invariant guard: tracks the latest status
  // actually applied to `detail`. Once terminal, a later-arriving response
  // (from continue() or cancel() - either can be in-flight when the other
  // resolves) is discarded rather than applied.
  const statusRef = useRef<string | undefined>(undefined);
  const cancelRequestedRef = useRef(false);
  const runContinueRef = useRef<() => void>(() => {});
  // Mirrors `detail` state, written only inside applyResult() below - lets
  // refreshAfterMutation() read the LATEST known-good detail for its
  // merge-fallback without depending on `detail` state directly, which
  // would otherwise make runContinue's own identity change on every poll
  // tick (breaking the stable-callback-identity property the mount/reset
  // effect below relies on, the same way runContinueRef solves the
  // analogous problem for the self-scheduling setTimeout).
  const detailRef = useRef<WalkForwardExperimentDetailView | null | undefined>(null);

  // The one place any server response is ever applied to `detail` -
  // enforces the terminal-state invariant before every write. Accepts
  // either the full detail shape or the lightweight summary merged onto
  // the last known-good detail (see mergeSummary below) - both are real
  // backend data, never computed here.
  const applyResult = useCallback((result: WalkForwardExperimentDetailView) => {
    if (statusRef.current && isTerminalStatus(statusRef.current)) return;
    statusRef.current = result.status;
    detailRef.current = result;
    setDetail(result);
  }, []);

  const refreshAfterMutation = useCallback(
    async (summary: WalkForwardExperimentView) => {
      const fresh = await fetchWalkForwardExperiment(experimentId);
      if (cancelledRef.current) return;
      const toApply = fresh ?? mergeSummary(detailRef.current, summary);
      if (toApply) applyResult(toApply);
    },
    [experimentId, applyResult],
  );

  const runContinue = useCallback(async () => {
    if (cancelledRef.current || inFlightRef.current || cancelRequestedRef.current) return;
    inFlightRef.current = true;
    try {
      const result = await continueWalkForwardExperiment(experimentId);
      inFlightRef.current = false;
      if (cancelledRef.current) return;
      await refreshAfterMutation(result);
      setContinueError(null);
      setCancelError(null);
      if (!isTerminalStatus(result.status) && !cancelRequestedRef.current) {
        timeoutRef.current = setTimeout(() => runContinueRef.current(), CONTINUE_POLL_FLOOR_MS);
      }
    } catch (err) {
      inFlightRef.current = false;
      if (cancelledRef.current) return;
      // Stop automatic polling on ANY continue() failure (PROVIDER_ERROR
      // most notably), preserve the real server message, offer manual
      // Retry - never an automatic retry loop.
      setContinueError(err instanceof WalkForwardClientError ? err : new WalkForwardClientError("UNKNOWN", err instanceof Error ? err.message : "Failed to continue the walk-forward experiment."));
    }
  }, [experimentId, refreshAfterMutation]);

  useEffect(() => {
    runContinueRef.current = runContinue;
  }, [runContinue]);

  useEffect(() => {
    cancelledRef.current = false;
    inFlightRef.current = false;
    cancelRequestedRef.current = false;
    statusRef.current = undefined;
    detailRef.current = null;
    setDetail(null);
    setContinueError(null);
    setCancelError(null);
    setShowCancelModal(false);
    setCancelling(false);

    fetchWalkForwardExperiment(experimentId).then((fetched) => {
      if (cancelledRef.current) return;
      if (!fetched) {
        setDetail(undefined);
        return;
      }
      applyResult(fetched);
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
    cancelRequestedRef.current = true;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    try {
      const result = await cancelWalkForwardExperiment(experimentId);
      if (cancelledRef.current) return;
      await refreshAfterMutation(result);
    } catch (err) {
      if (cancelledRef.current) return;
      setCancelError(err instanceof WalkForwardClientError ? err : new WalkForwardClientError("UNKNOWN", err instanceof Error ? err.message : "Failed to cancel the walk-forward experiment."));
      // The cancel request itself failed - the experiment is presumably
      // still QUEUED/RUNNING server-side. Un-pause continuation rather
      // than leaving the UI stuck.
      cancelRequestedRef.current = false;
      runContinueRef.current();
    } finally {
      if (!cancelledRef.current) setCancelling(false);
    }
  }

  const totalCandidatesSoFar = detail ? detail.folds.reduce((sum, f) => sum + f.candidates.length, 0) : 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/dashboard/algo-test-walk-forward" className="text-xs text-text-3 hover:text-gold">
        ← Walk-Forward Setup
      </Link>

      {detail === null ? (
        <div className="space-y-3">
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : detail === undefined ? (
        <ErrorState title="Walk-forward experiment not found." description="It may not exist, or it may belong to someone else." />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-2xl font-bold text-text">Walk-Forward Optimization</h1>
            <Badge tone={STATUS_TONE[detail.status]}>{detail.status}</Badge>
          </div>

          <div className="rounded-card border border-border bg-ink-2 p-5">
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className={FIN_LABEL}>Strategy</dt>
                <dd className="mt-0.5 text-text">{detail.strategyId}</dd>
              </div>
              <div>
                <dt className={FIN_LABEL}>Symbol / Timeframe</dt>
                <dd className="mt-0.5 text-text">
                  {detail.symbol} · {detail.timeframe}
                </dd>
              </div>
              <div>
                <dt className={FIN_LABEL}>Date range</dt>
                <dd className="mt-0.5 text-text">
                  {formatDateOnly(detail.startTime)} – {formatDateOnly(detail.endTime)}
                </dd>
              </div>
              <div>
                <dt className={FIN_LABEL}>Initial balance</dt>
                <dd className="mt-0.5 text-text">{detail.initialBalance.toLocaleString()}</dd>
              </div>
              <div>
                <dt className={FIN_LABEL}>Folds</dt>
                <dd className="mt-0.5 text-text">
                  {detail.foldsCompleted} / {detail.totalFolds} completed
                </dd>
              </div>
              <div>
                <dt className={FIN_LABEL}>Candidates run so far</dt>
                <dd className="mt-0.5 text-text">{totalCandidatesSoFar}</dd>
              </div>
            </dl>
          </div>

          {/* P4.9-C.2 lock (sprint §6/§7) - the process verdict has its own
              clearly-labelled, structurally separate card, rendered ONLY
              when the backend has actually persisted one. Never rendered
              from a computed/inferred value - detail.verdict is read
              verbatim, exactly as bestCandidateId is in Optimization. */}
          {detail.verdict && (
            <div className="rounded-card border border-border bg-ink-2 p-5">
              <p className={FIN_LABEL}>Process Verdict</p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <Badge tone={VERDICT_TONE[detail.verdict]}>{detail.verdict}</Badge>
                <span className="text-xs text-text-3">
                  {detail.passedFoldCount} / {detail.conclusiveFoldCount} conclusive fold{detail.conclusiveFoldCount === 1 ? "" : "s"} passed out-of-sample validation
                  {detail.totalFolds !== detail.conclusiveFoldCount ? ` (${detail.totalFolds - detail.conclusiveFoldCount} inconclusive)` : ""}
                </span>
              </div>
              <p className="mt-3 text-xs text-text-3">
                This verdict reflects out-of-sample evidence across every fold, not any single candidate&apos;s own in-sample performance. A high in-sample profit factor on an individual candidate does not by itself mean this experiment PASSED.
              </p>
            </div>
          )}

          {!isTerminalStatus(detail.status) ? (
            <div className="rounded-card border border-border bg-ink-2 p-5">
              <p className={FIN_LABEL}>Progress</p>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-ink-3">
                <div
                  className="h-full rounded-full bg-gold transition-[width]"
                  style={{ width: `${detail.totalFolds > 0 ? Math.min(100, (detail.foldsCompleted / detail.totalFolds) * 100) : 0}%` }}
                />
              </div>
              <p className="mt-2 text-sm text-text-2">
                {detail.foldsCompleted} / {detail.totalFolds} folds completed
              </p>
              <div className="mt-4">
                <Button variant="danger" size="sm" onClick={handleCancelClick} loading={cancelling}>
                  Cancel Experiment
                </Button>
              </div>
            </div>
          ) : detail.status === "CANCELLED" ? (
            <div className="rounded-card border border-border bg-ink-2 p-5">
              <p className="text-sm text-text-2">
                Cancelled — {detail.foldsCompleted}/{detail.totalFolds} folds completed before cancellation.
              </p>
            </div>
          ) : detail.status === "FAILED" && detail.errorMessage ? (
            <div className="rounded-card border border-border bg-ink-2 p-5">
              <p className="text-sm text-danger">{detail.errorMessage}</p>
            </div>
          ) : null}

          {/* Fold-level evidence remains inspectable regardless of terminal
              state (COMPLETED, FAILED, or CANCELLED) - sprint's own recon
              (§4/§5) requirement. Each fold owns its own candidates; there
              is no global candidate table (sprint §11 - no global WFO
              winner). */}
          {detail.folds.length > 0 && (
            <div className="space-y-4">
              <p className={FIN_LABEL}>Folds</p>
              {detail.folds.map((fold) => (
                <FoldSection key={fold.id} fold={fold} searchSpace={detail.searchSpace} />
              ))}
            </div>
          )}

          {continueError && (
            <Alert tone="danger" title="Could not continue the walk-forward experiment">
              <p>{continueError.message}</p>
              <div className="mt-3">
                <Button variant="danger" size="sm" onClick={handleRetry}>
                  Retry
                </Button>
              </div>
            </Alert>
          )}

          {cancelError && (
            <Alert tone="danger" title="Could not cancel the walk-forward experiment">
              <p>{cancelError.message}</p>
            </Alert>
          )}
        </div>
      )}

      <Modal open={showCancelModal} onClose={() => setShowCancelModal(false)} title="Cancel walk-forward experiment?">
        <p className="text-sm text-text-2">The current unit of work will finish before the experiment stops. Unprocessed folds/candidates will not be executed.</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setShowCancelModal(false)}>
            Keep running
          </Button>
          <Button variant="danger" size="sm" onClick={handleCancelConfirm}>
            Cancel experiment
          </Button>
        </div>
      </Modal>
    </div>
  );
}
