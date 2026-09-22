"use client";

// app/dashboard/algo-test-walk-forward/page.tsx
// P4.9-C.2 - Walk-Forward Setup. Adapted directly from
// app/dashboard/algo-test-optimize/page.tsx (P4.9-A.4-T1) - same fields,
// same client-side validation convention ("UI validates for UX, service
// validates for real"), same estimated-candidate display, same submit ->
// navigate behavior. The one deliberate omission: inSampleDays/
// outOfSampleDays/stepDays are NOT exposed anywhere in this form -
// CreateWalkForwardExperimentRequest (types/walk-forward.ts) has no such
// fields at all, per the P4.9-B-R2 lock that they stay server-side
// constants, never client-configurable. There is nothing to omit a
// control FOR beyond simply never adding one.
//
// Strategy/parameter data comes EXCLUSIVELY from GET /api/private/algo-test/strategies
// (fetchAlgoTestStrategies()) - the same registry endpoint the Optimization
// setup page already uses, never duplicated locally.
//
// Reads ?strategyId= via window.location.search inside a mount effect,
// not next/navigation's useSearchParams() - mirrors the Optimization setup
// page's own established convention (this codebase's documented prior
// useSearchParams()/prerender hydration bug).
// Sprint UI-02.2 - same visual-only pass as its sibling
// algo-test-optimize/page.tsx: self max-w-3xl wrapper removed, "no
// optimizable strategy" text now uses EmptyState. Form <section>s
// unchanged (same rounded-card/border-border/bg-ink-2 tokens Card would
// render, kept as <section> for the same reasons noted there).
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import Skeleton from "@/components/ui/Skeleton";
import Select from "@/components/ui/Select";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import Alert from "@/components/ui/Alert";
import EmptyState from "@/components/ui/EmptyState";
import { FIN_LABEL } from "@/components/ui/financial-typography";
import { fetchAlgoTestStrategies } from "@/lib/algo-test/store";
import { createWalkForwardExperiment } from "@/lib/algo-test/walk-forward-store";
import type { AlgoTestParameterDefinition, AlgoTestStrategyDefinition } from "@/types/algo-test";
import type { WalkForwardParameterRange } from "@/types/walk-forward";

// Mirrors the real, locked services/algo-test/optimization.service.ts
// OPTIMIZATION_CANDIDATE_CAP (reused verbatim by walk-forward.service.ts
// as its own candidateCap, per the locked "candidateCap: 256 (unchanged)"
// R2 table entry) - a UX display/estimate value only, this is PER FOLD
// (each fold runs its own independent in-sample sweep), never a total
// across every fold. The service's own real response remains the sole
// authority; this number never silently truncates a request.
const WALK_FORWARD_CANDIDATE_CAP_PER_FOLD = 256;

const DEFAULT_INITIAL_BALANCE = 10_000;
// Same flat client-side hint the Optimization setup page already uses -
// the server's real maxRangeDaysFor() is timeframe-aware and remains
// authoritative; this is a UX estimate only. For WFO this is the TOTAL
// span across every fold (P4.9-B-R2 locked - bounded to the same
// per-request provider cap ordinary optimization already respects), not
// a per-fold range.
const MAX_RANGE_DAYS = 14;

const TIMEFRAME_DISPLAY_LABEL: Readonly<Record<string, string>> = { "5m": "M5", "15m": "M15", "1h": "H1" };

function timeframeLabel(tf: string): string {
  return TIMEFRAME_DISPLAY_LABEL[tf] ?? tf;
}

function isoDateNDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function toEngineTimestamp(dateOnly: string, endOfDay: boolean): string {
  return `${dateOnly}T${endOfDay ? "23:59:59" : "00:00:00"}Z`;
}

interface SweepFormValue {
  readonly enabled: boolean;
  readonly min: string;
  readonly max: string;
  readonly step: string;
}

function defaultSweepValues(parameters: readonly AlgoTestParameterDefinition[]): Record<string, SweepFormValue> {
  const values: Record<string, SweepFormValue> = {};
  for (const p of parameters) {
    values[p.id] = { enabled: false, min: p.min !== undefined ? String(p.min) : "", max: p.max !== undefined ? String(p.max) : "", step: "" };
  }
  return values;
}

/** One swept parameter's client-side validation - a UX convenience only; walkForwardService's own validateCreateRequest() remains the sole authority (identical "UI validates for UX, service validates for real" convention the Optimization setup page already establishes). */
function validateSweepValue(param: AlgoTestParameterDefinition, value: SweepFormValue): string | undefined {
  if (!value.enabled) return undefined;
  if (value.min.trim() === "") return "Min is required.";
  if (value.max.trim() === "") return "Max is required.";
  if (value.step.trim() === "") return "Step is required.";
  const min = Number(value.min);
  const max = Number(value.max);
  const step = Number(value.step);
  if (!Number.isFinite(min)) return "Min must be a number.";
  if (!Number.isFinite(max)) return "Max must be a number.";
  if (!Number.isFinite(step) || step <= 0) return "Step must be a number greater than 0.";
  if (min > max) return "Min must be <= max.";
  if (param.min !== undefined && min < param.min) return `Min must be >= ${param.min}.`;
  if (param.max !== undefined && max > param.max) return `Max must be <= ${param.max}.`;
  return undefined;
}

/** Floating-point-safe step count, same discipline as optimization.service.ts's own stepCountFor(). Per-fold candidate count estimate - the real per-fold total is computed server-side identically for every fold (the search space is shared across folds, per the R2 lock), so one estimate here covers all of them. */
function stepCountFor(value: SweepFormValue): number {
  const min = Number(value.min);
  const max = Number(value.max);
  const step = Number(value.step);
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(step) || step <= 0) return 0;
  return Math.floor((max - min) / step + 1e-9) + 1;
}

export default function AlgoTestWalkForwardSetupPage() {
  const router = useRouter();
  const [strategies, setStrategies] = useState<AlgoTestStrategyDefinition[] | null>(null);
  const [selectedStrategyId, setSelectedStrategyId] = useState<string>("");
  const [symbol, setSymbol] = useState<string>("");
  const [timeframe, setTimeframe] = useState<string>("");
  const [startDate, setStartDate] = useState(() => isoDateNDaysAgo(14));
  const [endDate, setEndDate] = useState(() => isoDateNDaysAgo(1));
  const [initialBalance, setInitialBalance] = useState(String(DEFAULT_INITIAL_BALANCE));
  const [sweepValues, setSweepValues] = useState<Record<string, SweepFormValue>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetchAlgoTestStrategies().then((fetched) => {
      if (cancelled) return;
      // Same locked visibility rule the Optimization setup page uses:
      // registry (already guaranteed by this endpoint) + parameters.length > 0.
      const optimizable = fetched.filter((s) => s.parameters.length > 0);
      setStrategies(optimizable);
      const preselected = new URLSearchParams(window.location.search).get("strategyId");
      const initial = optimizable.find((s) => s.strategyId === preselected) ?? optimizable[0];
      if (initial) {
        setSelectedStrategyId(initial.strategyId);
        setSymbol(initial.supportedSymbols[0] ?? "");
        setTimeframe(initial.supportedTimeframes[0] ?? "");
        setSweepValues(defaultSweepValues(initial.parameters));
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const strategyDef = strategies?.find((s) => s.strategyId === selectedStrategyId);
  const parameters = strategyDef?.parameters ?? [];

  function handleSelectStrategy(strategyId: string) {
    const def = strategies?.find((s) => s.strategyId === strategyId);
    setSelectedStrategyId(strategyId);
    if (def) {
      setSymbol(def.supportedSymbols[0] ?? "");
      setTimeframe(def.supportedTimeframes[0] ?? "");
      setSweepValues(defaultSweepValues(def.parameters));
    }
  }

  function updateSweep(parameterId: string, patch: Partial<SweepFormValue>) {
    setSweepValues((prev) => ({ ...prev, [parameterId]: { ...prev[parameterId]!, ...patch } }));
  }

  const enabledSweeps = parameters.filter((p) => sweepValues[p.id]?.enabled);
  const sweepErrors: Record<string, string> = {};
  for (const p of enabledSweeps) {
    const err = validateSweepValue(p, sweepValues[p.id]!);
    if (err) sweepErrors[p.id] = err;
  }
  const sweepsValid = Object.keys(sweepErrors).length === 0;

  // Locked formula: Π floor((max-min)/step) + 1 per swept parameter. Zero
  // swept parameters -> 1 (a valid degenerate single-candidate sweep at
  // every parameter's own default, per the already-locked service
  // contract - never blocked client-side either). Per fold - the actual
  // number of folds is server-derived (deriveFolds(), P4.9-B-R2 locked
  // formula) and not known until after creation, so this estimate is
  // deliberately labeled "per fold", never multiplied by a guessed fold
  // count.
  const estimatedCandidatesPerFold = enabledSweeps.length === 0 || !sweepsValid ? (enabledSweeps.length === 0 ? 1 : 0) : enabledSweeps.reduce((total, p) => total * stepCountFor(sweepValues[p.id]!), 1);
  const overCap = sweepsValid && estimatedCandidatesPerFold > WALK_FORWARD_CANDIDATE_CAP_PER_FOLD;

  const rangeDays = (new Date(endDate).getTime() - new Date(startDate).getTime()) / 86_400_000;
  const rangeValid = rangeDays > 0 && rangeDays <= MAX_RANGE_DAYS;
  const parsedBalance = Number(initialBalance);
  const balanceValid = Number.isFinite(parsedBalance) && parsedBalance > 0;

  const canSubmit = !!strategyDef && !!symbol && !!timeframe && rangeValid && balanceValid && sweepsValid && !overCap && !submitting;

  async function handleSubmit() {
    if (!strategyDef) return;
    setSubmitting(true);
    setSubmitError(undefined);
    try {
      const searchSpace: WalkForwardParameterRange[] = enabledSweeps.map((p) => ({
        parameterId: p.id,
        min: Number(sweepValues[p.id]!.min),
        max: Number(sweepValues[p.id]!.max),
        step: Number(sweepValues[p.id]!.step),
      }));
      const experiment = await createWalkForwardExperiment({
        strategyId: strategyDef.strategyId,
        symbol,
        timeframe,
        startTime: toEngineTimestamp(startDate, false),
        endTime: toEngineTimestamp(endDate, true),
        initialBalance: parsedBalance,
        searchSpace,
      });
      // Client-side nav (keeps browser back-button history), same
      // convention the Optimization setup page already uses.
      router.push(`/dashboard/algo-test-walk-forward/${encodeURIComponent(experiment.experimentId)}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to create walk-forward experiment.");
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Algo Testing Pro"
        title="Walk-Forward Optimization"
        description="Sweep a strategy's own parameters independently across rolling in-sample/out-of-sample folds and get an honest PASSED / FAILED / INCONCLUSIVE verdict, not a single best-fit backtest."
      />

      {strategies === null ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : strategies.length === 0 ? (
        <EmptyState title="No optimizable strategies" description="No registry strategy currently declares an optimizable parameter." />
      ) : (
        <div className="space-y-6">
          <section className="space-y-4 rounded-card border border-border bg-ink-2 p-5">
            <label className="flex flex-col gap-1">
              <span className={FIN_LABEL}>Strategy</span>
              <Select value={selectedStrategyId} onChange={(e) => handleSelectStrategy(e.target.value)}>
                {strategies.map((s) => (
                  <option key={s.strategyId} value={s.strategyId}>
                    {s.displayName}
                  </option>
                ))}
              </Select>
            </label>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className={FIN_LABEL}>Symbol</span>
                <Select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
                  {(strategyDef?.supportedSymbols ?? []).map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="flex flex-col gap-1">
                <span className={FIN_LABEL}>Timeframe</span>
                <Select value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
                  {(strategyDef?.supportedTimeframes ?? []).map((tf) => (
                    <option key={tf} value={tf}>
                      {timeframeLabel(tf)}
                    </option>
                  ))}
                </Select>
              </label>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <label className="flex flex-col gap-1">
                <span className={FIN_LABEL}>Start date</span>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} invalid={!rangeValid} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={FIN_LABEL}>End date</span>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} invalid={!rangeValid} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={FIN_LABEL}>Initial balance</span>
                <Input type="number" min="0" step="any" value={initialBalance} onChange={(e) => setInitialBalance(e.target.value)} invalid={!balanceValid} />
              </label>
            </div>
            {!rangeValid && <p className="text-[11px] text-danger">{rangeDays <= 0 ? "Start date must be before end date." : `Total span must be ${MAX_RANGE_DAYS} days or less (currently ${rangeDays.toFixed(1)}).`}</p>}
            {!balanceValid && <p className="text-[11px] text-danger">Initial balance must be a positive number.</p>}
            <p className="text-[11px] text-text-3">The date range is split into rolling in-sample/out-of-sample folds automatically - fold length and step are fixed by the platform, not configurable here.</p>
          </section>

          <section className="space-y-3 rounded-card border border-border bg-ink-2 p-5">
            <p className={FIN_LABEL}>Parameters to optimize</p>
            <div className="space-y-3">
              {parameters.map((p) => {
                const value = sweepValues[p.id];
                if (!value) return null;
                const error = sweepErrors[p.id];
                return (
                  <div key={p.id} className="rounded-control border border-border/60 p-3">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={value.enabled} onChange={(e) => updateSweep(p.id, { enabled: e.target.checked })} className="h-4 w-4 rounded border-border bg-ink-3 accent-gold" />
                      <span className="text-sm font-medium text-text">{p.label}</span>
                      <span className="text-[11px] text-text-3">
                        (default {String(p.defaultValue)}
                        {p.min !== undefined || p.max !== undefined ? `, allowed ${p.min ?? "−∞"}–${p.max ?? "∞"}` : ""})
                      </span>
                    </label>
                    {value.enabled && (
                      <div className="mt-2 grid grid-cols-3 gap-3">
                        <label className="flex flex-col gap-0.5">
                          <span className={FIN_LABEL}>Min</span>
                          <Input type="number" value={value.min} onChange={(e) => updateSweep(p.id, { min: e.target.value })} invalid={!!error} />
                        </label>
                        <label className="flex flex-col gap-0.5">
                          <span className={FIN_LABEL}>Max</span>
                          <Input type="number" value={value.max} onChange={(e) => updateSweep(p.id, { max: e.target.value })} invalid={!!error} />
                        </label>
                        <label className="flex flex-col gap-0.5">
                          <span className={FIN_LABEL}>Step</span>
                          <Input type="number" value={value.step} onChange={(e) => updateSweep(p.id, { step: e.target.value })} invalid={!!error} />
                        </label>
                      </div>
                    )}
                    {error && <p className="mt-1 text-[11px] text-danger">{error}</p>}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="flex flex-col gap-3 rounded-card border border-border bg-ink-2 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className={FIN_LABEL}>Estimated candidates per fold</p>
              <p className={`mt-1 text-lg font-semibold ${overCap ? "text-danger" : "text-text"}`}>
                {sweepsValid ? estimatedCandidatesPerFold : "—"} / {WALK_FORWARD_CANDIDATE_CAP_PER_FOLD}
              </p>
              {overCap && <p className="text-[11px] text-danger">Reduce the range or increase the step on one or more parameters - this search space is too large to run per fold.</p>}
              {enabledSweeps.length === 0 && <p className="text-[11px] text-text-3">No parameter selected - each fold will run a single candidate at every parameter&apos;s own default value.</p>}
            </div>
            <Button onClick={handleSubmit} disabled={!canSubmit} loading={submitting}>
              Create Experiment
            </Button>
          </section>

          {submitError && (
            <Alert tone="danger" title="Could not create the experiment">
              {submitError}
            </Alert>
          )}
        </div>
      )}
    </div>
  );
}
