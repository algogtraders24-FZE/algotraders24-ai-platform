"use client";

// components/chart-engine/AlgoTestPanel.tsx
// P3.2B - the first real end-to-end Native Chart Algo Testing vertical
// slice. Slots into NativeChart.tsx in the same vertical stack
// PaperTradingPanel already occupies, gated the same way
// (isActive={symbol === activeSymbol}) - only the primary/active pane
// shows it. The server (algo-test.service.ts) is the ONLY place that
// calls at24-quant-engine - this component only ever renders numbers the
// engine already computed (metrics/trades/equityCurve/lifecycle/compiled
// strategy), never recalculates any of them.
//
// P4.3 (docs/P4.3-SURFACE-THE-FOUNDATION.md) - "Surface the Foundation":
// this is a product-surface sprint over the existing P3/P4 backend, not a
// new engine-capability sprint. Three things changed structurally from
// the P3.2B/P3.3/P3.4 version of this file:
//   1. Strategy selection is no longer hardcoded to Golden Strategy - a
//      Registry-vs-AI mode toggle plus a real strategy picker prove the
//      UI is genuinely generic (P3.6's own registry), not a single-path
//      demo.
//   2. An AI Strategy mode submits a natural-language request through
//      the EXISTING P4.1/P4.2 compile+run endpoint
//      (compileAndRunAiStrategy, lib/algo-test/store.ts) - never a
//      second, parallel AI execution path.
//   3. AlgoTestResults is now a genuinely unified result surface: the
//      SAME component renders a registry result and an AI result,
//      branching only on which fields are PRESENT on the returned
//      AlgoTestRunView (run.compiledStrategy, run.lifecycle,
//      run.strategyHash) - never on `strategyId`/`mode`. New sections
//      (LifecycleBadges, CompiledStrategyCard, RunIdentityCard) surface
//      P3.8 evidence and the compiled StrategySpec, both of which were
//      already computed server-side and simply never rendered before
//      this sprint.
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import Badge, { type BadgeTone } from "@/components/ui/Badge";
import Modal from "@/components/ui/Modal";
import StatField from "@/components/workspace/StatField";
import { FIN_LABEL, FIN_PRIMARY, FIN_SECONDARY, FIN_TERTIARY } from "@/components/ui/financial-typography";
import { formatPrice, formatPercent, formatTimestamp } from "@/lib/financial-format";
import { runAlgoTest, compileAndRunAiStrategy, fetchAlgoTestRun, fetchAlgoTestStrategies } from "@/lib/algo-test/store";
import { ALGO_TEST_LIFECYCLE_STAGES as LIFECYCLE_STAGES } from "@/types/algo-test";
import type {
  AlgoTestAnalyticsView,
  AlgoTestCompiledStrategyView,
  AlgoTestLifecycleResult,
  AlgoTestLifecycleStage,
  AlgoTestParameterDefinition,
  AlgoTestRunView,
  AlgoTestStrategyDefinition,
  AlgoTestTradeView,
} from "@/types/algo-test";
import type { AlgoTestTradeMarker } from "@/lib/chart-engine/renderer";
import type { ChartCandle } from "@/types/chart-data";

/** P3.3 - the URL query param a completed run's id is round-tripped through, so a browser refresh reopens the same persisted result instead of losing it (Result Detail Page reopen requirement). */
const REOPEN_QUERY_PARAM = "algoTestId";

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

type AlgoTestMode = "registry" | "ai";

const DEFAULT_INITIAL_BALANCE = 10_000;
const MAX_RANGE_DAYS = 14;
const MAX_INTENT_LENGTH = 2000;

const TIMEFRAME_DISPLAY_LABEL: Readonly<Record<string, string>> = { "5m": "M5", "15m": "M15", "1h": "H1" };

function timeframeLabel(tf: string | undefined): string {
  if (!tf) return "—";
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

/**
 * P3.4 - form state for parameter inputs is always string-keyed/string-
 * valued (React controlled-input convention), regardless of the
 * parameter's real type - converted to its real type only at submit time
 * (toParameterPayload below). Seeding this from `param.defaultValue` is
 * the ONLY place a default is read from - never a second, hand-typed
 * default living in this component.
 */
function defaultFormValues(parameters: readonly AlgoTestParameterDefinition[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const p of parameters) values[p.id] = String(p.defaultValue);
  return values;
}

/** Client-side mirror of the server's own per-type validation (algo-test.service.ts's validateParameterValues) - a UX convenience for inline error text; the server independently re-validates and remains the sole authority. */
function validateParamFormValue(param: AlgoTestParameterDefinition, raw: string): string | undefined {
  if (raw.trim().length === 0) return param.required ? "Required." : undefined;
  if (param.type === "number" || param.type === "integer") {
    const n = Number(raw);
    if (!Number.isFinite(n)) return "Must be a number.";
    if (param.type === "integer" && !Number.isInteger(n)) return "Must be a whole number.";
    if (param.min !== undefined && n < param.min) return `Must be >= ${param.min}.`;
    if (param.max !== undefined && n > param.max) return `Must be <= ${param.max}.`;
    return undefined;
  }
  if (param.type === "select" && param.options && !param.options.includes(raw)) return `Must be one of: ${param.options.join(", ")}.`;
  return undefined;
}

/** Converts the form's string-keyed values into the real (number|boolean|string)-typed payload the API expects - only for parameters the user actually touched away from a blank/invalid state; an untouched or invalid field is simply omitted so the server falls back to its own registered default rather than receiving a bad value. */
function toParameterPayload(parameters: readonly AlgoTestParameterDefinition[], formValues: Record<string, string>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const p of parameters) {
    const raw = formValues[p.id];
    if (raw === undefined || raw.trim().length === 0) continue;
    if (validateParamFormValue(p, raw) !== undefined) continue;
    if (p.type === "number" || p.type === "integer") payload[p.id] = Number(raw);
    else if (p.type === "boolean") payload[p.id] = raw === "true";
    else payload[p.id] = raw;
  }
  return payload;
}

const AlgoTestPanel = forwardRef<AlgoTestPanelHandle, AlgoTestPanelProps>(function AlgoTestPanel(
  { symbol, isActive, onOverlayChange, selectedTradeId, onSelectTrade },
  ref,
) {
  const [configOpen, setConfigOpen] = useState(false);
  const [mode, setMode] = useState<AlgoTestMode>("registry");

  // P4.3 - the FULL Strategy Registry (P3.6), not just Golden Strategy -
  // the picker below is the "smallest viable strategy selection
  // mechanism" the sprint asks for. Golden remains the default selection
  // purely as a convenience (unchanged first-run experience), never the
  // only reachable strategy.
  const [strategies, setStrategies] = useState<AlgoTestStrategyDefinition[]>([]);
  const [selectedStrategyId, setSelectedStrategyId] = useState<string>("golden");
  const strategyDef = strategies.find((s) => s.strategyId === selectedStrategyId);

  // P3.4 - string-keyed form state for the registry-declared parameters,
  // seeded from the registry's own defaultValue once strategyDef loads
  // (see the mount effect below) - never a second, hand-typed default.
  const [paramValues, setParamValues] = useState<Record<string, string>>({});

  // P4.3 - AI Strategy mode's own input. Deliberately just the raw
  // natural-language request - no structured parameter form, matching
  // P4.1's own compiler contract (the intent IS the input).
  const [intent, setIntent] = useState("");

  const [startDate, setStartDate] = useState(() => isoDateNDaysAgo(7));
  // Live-verification finding (P3.2B): defaulting to isoDateNDaysAgo(0)
  // ("today") looked right but always failed - the server converts endDate
  // to end-of-day UTC (toEngineTimestamp's endOfDay=true, "23:59:59Z"), which
  // is later than "now" for essentially the entire current UTC day. Defaulting
  // to yesterday keeps the same convention but is always safely in the past.
  const [endDate, setEndDate] = useState(() => isoDateNDaysAgo(1));
  const [initialBalance, setInitialBalance] = useState(String(DEFAULT_INITIAL_BALANCE));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [run, setRun] = useState<AlgoTestRunView | undefined>(undefined);
  const [reopening, setReopening] = useState(false);

  useImperativeHandle(ref, () => ({ openConfig: () => setConfigOpen(true) }), []);

  // P3.3/P4.3 - Strategy Registry, fetched once on mount. Golden is the
  // default SELECTION (a convenience), never the only OPTION - the
  // picker in the Modal renders every entry `strategies` holds.
  useEffect(() => {
    let cancelled = false;
    fetchAlgoTestStrategies().then((fetched) => {
      if (cancelled) return;
      setStrategies(fetched);
      const golden = fetched.find((s) => s.strategyId === "golden") ?? fetched[0];
      if (golden) {
        setSelectedStrategyId(golden.strategyId);
        setParamValues(defaultFormValues(golden.parameters));
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // P3.3 - Result Detail Page reopen: a persisted result survives a
  // refresh because its testId round-trips through the URL query string
  // (see handleSubmit's history.replaceState below). This re-fetches the
  // PERSISTED run only - never re-runs the engine. P4.3 disclosed that
  // `lifecycle`, `compiledStrategy` and `strategyHash` were NOT persisted
  // to the AlgoTestRun row; P4.5 (docs/P4.5-STRATEGY-RUN-IDENTITY-PERSISTENCE.md)
  // closed that gap - all three now round-trip through a reopen for any
  // run created after this phase shipped. A pre-P4.5 row genuinely still
  // comes back WITHOUT them (never backfilled with a guess), and the
  // result components below still render an explicit "unavailable" state
  // for exactly that case, never a fabricated one.
  useEffect(() => {
    const testId = new URLSearchParams(window.location.search).get(REOPEN_QUERY_PARAM);
    if (!testId) return;
    let cancelled = false;
    setReopening(true);
    fetchAlgoTestRun(testId).then((fetched) => {
      if (cancelled || !fetched) {
        setReopening(false);
        return;
      }
      setRun(fetched);
      setReopening(false);
      if (fetched.status === "completed" && fetched.candles && fetched.trades && fetched.symbol === symbol) {
        onOverlayChange({
          candles: fetched.candles,
          trades: fetched.trades.map(
            (t): AlgoTestTradeMarker => ({ tradeId: t.tradeId, side: t.side, entryTime: t.entryTime, entryPrice: t.entryPrice, exitTime: t.exitTime, exitPrice: t.exitPrice }),
          ),
        });
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reopen is a one-time, mount-time reconciliation of the URL's own testId, not a reaction to onOverlayChange identity
  }, []);

  if (!isActive) return null;

  // P4.3 - the chart-symbol gate is now scoped to Registry mode only
  // (per-selected-strategy, never hardcoded to Golden's own XAUUSD). AI
  // mode has no pre-known symbol until the natural-language request is
  // actually compiled - the AI compiler supports 7 symbols
  // (schema.ts's AI_COMPILER_SUPPORTED_SYMBOLS), not one, so it would be
  // dishonest to gate the whole mode on this chart pane's own symbol.
  // If a completed AI run's own resulting symbol differs from this
  // pane's symbol, the results below say so explicitly and simply do
  // not push a mismatched chart overlay (see handleSubmit).
  const registrySupportedSymbol = strategyDef?.supportedSymbols[0];
  const registrySymbolBlocked = mode === "registry" && registrySupportedSymbol !== undefined && symbol !== registrySupportedSymbol;

  if (registrySymbolBlocked) {
    return (
      <div className="rounded-control border border-border bg-ink-3 px-3 py-2.5">
        <p className={FIN_LABEL}>Algo Testing (Pro)</p>
        <p className={`${FIN_TERTIARY} mt-1`}>
          {strategyDef?.displayName} only supports {registrySupportedSymbol}. Switch this pane&apos;s symbol, or pick a different strategy, or switch to AI Strategy mode.
        </p>
      </div>
    );
  }

  const parameters = strategyDef?.parameters ?? [];
  const paramErrors: Record<string, string> = {};
  for (const p of parameters) {
    const err = validateParamFormValue(p, paramValues[p.id] ?? "");
    if (err) paramErrors[p.id] = err;
  }
  const parametersValid = Object.keys(paramErrors).length === 0;

  const rangeDays = (new Date(endDate).getTime() - new Date(startDate).getTime()) / 86_400_000;
  const parsedBalance = Number(initialBalance);
  const balanceValid = Number.isFinite(parsedBalance) && parsedBalance > 0;
  const rangeValid = rangeDays > 0 && rangeDays <= MAX_RANGE_DAYS;
  const intentValid = mode === "ai" ? intent.trim().length > 0 && intent.length <= MAX_INTENT_LENGTH : true;
  const canSubmit = balanceValid && rangeValid && intentValid && (mode === "registry" ? parametersValid : true) && !submitting;

  function handleResetParameters() {
    setParamValues(defaultFormValues(parameters));
  }

  function applyResult(result: AlgoTestRunView) {
    setRun(result);
    onSelectTrade(null);
    if (result.status === "completed" && result.candles && result.trades && result.symbol === symbol) {
      onOverlayChange({
        candles: result.candles,
        trades: result.trades.map(
          (t): AlgoTestTradeMarker => ({ tradeId: t.tradeId, side: t.side, entryTime: t.entryTime, entryPrice: t.entryPrice, exitTime: t.exitTime, exitPrice: t.exitPrice }),
        ),
      });
      setConfigOpen(false);
      // P3.3 - round-trip this completed run's id through the URL so a
      // browser refresh reopens the exact same persisted result (see the
      // reopen effect above) instead of losing it.
      const url = new URL(window.location.href);
      url.searchParams.set(REOPEN_QUERY_PARAM, result.testId);
      window.history.replaceState(null, "", url.toString());
    } else if (result.status === "completed") {
      // A real, completed run whose own symbol does not match this
      // chart pane (AI mode only - see the doc comment above). Never
      // silently dropped: results still render below, just not
      // overlaid on a mismatched chart.
      setConfigOpen(false);
    }
    // A handled `status: "failed"` result is NOT set as the top-level
    // `error` (a real bug this phase's own visual QA caught: doing so
    // hid AlgoTestResults - and with it the failure's real lifecycle
    // detail and any compiled-strategy-before-the-failure - behind a
    // duplicate, less informative banner). `run` already holds the
    // failed result; AlgoTestResults renders its own, more detailed
    // failure state from it. `error` stays reserved for a genuinely
    // thrown exception (handleSubmit's catch block, below), where no
    // `run` object exists at all to render.
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(undefined);
    try {
      const result =
        mode === "registry"
          ? await runAlgoTest({
              strategyId: strategyDef?.strategyId ?? "golden",
              strategyVersion: strategyDef?.strategyVersion,
              parameters: toParameterPayload(parameters, paramValues),
              symbol,
              timeframe: strategyDef?.supportedTimeframes[0] ?? "5m",
              startTime: toEngineTimestamp(startDate, false),
              endTime: toEngineTimestamp(endDate, true),
              initialBalance: parsedBalance,
            })
          : await compileAndRunAiStrategy({
              intent,
              startTime: toEngineTimestamp(startDate, false),
              endTime: toEngineTimestamp(endDate, true),
              initialBalance: parsedBalance,
            });
      applyResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run Algo Test");
    } finally {
      setSubmitting(false);
    }
  }

  function handleClearResults() {
    setRun(undefined);
    setError(undefined);
    onSelectTrade(null);
    onOverlayChange(null);
    const url = new URL(window.location.href);
    url.searchParams.delete(REOPEN_QUERY_PARAM);
    window.history.replaceState(null, "", url.toString());
  }

  const activeSymbol = mode === "registry" ? (registrySupportedSymbol ?? symbol) : (run?.symbol ?? symbol);
  const activeTimeframeLabel = mode === "registry" ? timeframeLabel(strategyDef?.supportedTimeframes[0]) : timeframeLabel(run?.timeframe);
  const strategyLabel = mode === "registry" ? (strategyDef?.displayName ?? "Strategy") : (run?.compiledStrategy?.name ?? "AI Strategy");

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

      {reopening && <p className={`${FIN_TERTIARY} mt-1`}>Reopening the saved result…</p>}

      {!reopening && !run && (
        <p className={`${FIN_TERTIARY} mt-1`}>
          Run a real backtest against historical data - a Strategy Registry entry, or a natural-language AI strategy. Click &quot;Algo Test&quot; in the chart toolbar to configure a run.
        </p>
      )}

      {!reopening && run && <AlgoTestResults run={run} fallbackStrategyLabel={strategyLabel} selectedTradeId={selectedTradeId} onSelectTrade={onSelectTrade} activePaneSymbol={symbol} />}

      {/* `error` is reserved for a genuinely thrown exception (network/transport failure) - handleSubmit's catch block, where no `run` object exists at all. A HANDLED `run.status === "failed"` result renders its own, more detailed failure state inside AlgoTestResults above, never here. */}
      {error && (
        <div className="mt-2 rounded-control border border-danger/30 bg-danger/10 px-2.5 py-2">
          <p className={`${FIN_LABEL} text-danger`}>Request failed</p>
          <p className="mt-1 text-[11px] text-danger">{error}</p>
        </div>
      )}

      <Modal open={configOpen} onClose={() => setConfigOpen(false)} title="Configure Algo Test">
        <div className="space-y-3">
          <div className="flex gap-1 rounded-control border border-border bg-ink p-0.5">
            <ModeTab label="Registry Strategy" active={mode === "registry"} onClick={() => setMode("registry")} />
            <ModeTab label="AI Strategy" active={mode === "ai"} onClick={() => setMode("ai")} />
          </div>

          {mode === "registry" ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-0.5">
                  <span className={FIN_LABEL}>Strategy</span>
                  <select
                    value={selectedStrategyId}
                    onChange={(e) => {
                      setSelectedStrategyId(e.target.value);
                      const next = strategies.find((s) => s.strategyId === e.target.value);
                      setParamValues(defaultFormValues(next?.parameters ?? []));
                    }}
                    className="w-full rounded-control border border-border bg-ink px-2 py-1.5 text-sm text-text"
                  >
                    {strategies.map((s) => (
                      <option key={s.strategyId} value={s.strategyId}>
                        {s.displayName} (v{s.strategyVersion})
                      </option>
                    ))}
                  </select>
                </label>
                <StatField label="Symbol / Timeframe" bare>
                  <span className={FIN_SECONDARY}>
                    {activeSymbol} · {activeTimeframeLabel}
                  </span>
                </StatField>
              </div>
              {strategyDef?.description && <p className={FIN_TERTIARY}>{strategyDef.description}</p>}

              {parameters.length > 0 && (
                <div className="space-y-2 rounded-control border border-border bg-ink px-2.5 py-2">
                  <div className="flex items-baseline justify-between">
                    <span className={FIN_LABEL}>Parameters</span>
                    <button type="button" onClick={handleResetParameters} className="text-[11px] text-text-3 underline decoration-dotted hover:text-text-2">
                      Reset to defaults
                    </button>
                  </div>
                  {parameters.map((p) => (
                    <ParameterField
                      key={p.id}
                      param={p}
                      value={paramValues[p.id] ?? String(p.defaultValue)}
                      error={paramErrors[p.id]}
                      onChange={(v) => setParamValues((prev) => ({ ...prev, [p.id]: v }))}
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="space-y-2 rounded-control border border-border bg-ink px-2.5 py-2">
              <label className="flex flex-col gap-0.5">
                <span className={FIN_LABEL}>Strategy request</span>
                <textarea
                  value={intent}
                  onChange={(e) => setIntent(e.target.value)}
                  maxLength={MAX_INTENT_LENGTH}
                  rows={3}
                  placeholder="Buy when EMA 9 crosses above EMA 21 and sell when EMA 9 crosses below EMA 21."
                  className="w-full resize-none rounded-control border border-border bg-ink-3 px-2 py-1.5 text-sm text-text"
                />
                <span className="text-[11px] text-text-3">{intent.length}/{MAX_INTENT_LENGTH}</span>
              </label>
              <p className={FIN_TERTIARY}>
                The AI compiles this into a real, validated Universal Strategy IR - not executable code - then reduces it to a StrategySpec and runs it through the exact same backtest
                engine every registry strategy uses. The compiled strategy is shown below once it runs.
              </p>
            </div>
          )}

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
            Real historical data via Twelve Data. Execution assumptions (spread/slippage/fees are zero-cost placeholders; margin is not enforced) are shown with every result - never
            claimed to be broker-realistic.
          </p>
          {/* Both a thrown exception (`error`) and the last HANDLED failed run's own real errorMessage surface here, so the modal itself always explains a failed attempt without needing to be closed first - the fuller failure detail (lifecycle, compiled-strategy-if-any) is in AlgoTestResults, below the modal, once closed. */}
          {(error ?? (run?.status === "failed" ? run.errorMessage : undefined)) && (
            <p className="text-[11px] text-danger">{error ?? run?.errorMessage}</p>
          )}
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
              {submitting ? (mode === "registry" ? "Running Algo Test…" : "Compiling & running…") : mode === "registry" ? "Run Backtest" : "Compile & Run AI Strategy"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
});

export default AlgoTestPanel;

function ModeTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-control px-2 py-1.5 text-xs font-semibold transition ${
        active ? "bg-gold/10 text-gold" : "text-text-3 hover:text-text-2"
      }`}
    >
      {label}
    </button>
  );
}

/**
 * P3.4 - one registry-declared parameter, rendered with the control
 * appropriate to its `type` (never a raw JSON textbox - section 13's own
 * "do not expose raw JSON to normal users"). Only "number" is exercised
 * by the Golden Strategy today; boolean/select are implemented so a
 * future registered parameter of that type needs no new UI code, not
 * because this release invents a use for them.
 */
function ParameterField({
  param,
  value,
  error,
  onChange,
}: {
  param: AlgoTestParameterDefinition;
  value: string;
  error: string | undefined;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-0.5" title={param.description}>
      <span className={FIN_LABEL}>
        {param.label}
        {param.required ? " *" : ""}
      </span>
      {param.type === "boolean" ? (
        <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-control border border-border bg-ink-3 px-2 py-1.5 text-sm text-text">
          <option value="true">On</option>
          <option value="false">Off</option>
        </select>
      ) : param.type === "select" ? (
        <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-control border border-border bg-ink-3 px-2 py-1.5 text-sm text-text">
          {(param.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : (
        <input
          type="number"
          step={param.step ?? (param.type === "integer" ? 1 : "any")}
          min={param.min}
          max={param.max}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-control border border-border bg-ink-3 px-2 py-1.5 text-sm text-text"
        />
      )}
      {error && <span className="text-[11px] text-danger">{error}</span>}
      {!error && <span className="text-[11px] text-text-3">{param.description}</span>}
    </label>
  );
}

/**
 * P4.3 - the unified result surface (section 9 of the sprint spec):
 * one component, driven entirely by which fields `run` actually carries -
 * never a strategyId/mode branch. Renders lifecycle/evidence and the
 * compiled strategy for BOTH a completed run and a genuinely failed one
 * (a compile/validation/data failure still has real, inspectable state -
 * see section 12), and the full metrics/equity/trades body only once
 * `run.status === "completed"`.
 */
function AlgoTestResults({
  run,
  fallbackStrategyLabel,
  selectedTradeId,
  onSelectTrade,
  activePaneSymbol,
}: {
  run: AlgoTestRunView;
  fallbackStrategyLabel: string;
  selectedTradeId: string | null;
  onSelectTrade: (tradeId: string | null) => void;
  activePaneSymbol: string;
}) {
  const strategyName = run.compiledStrategy?.name ?? fallbackStrategyLabel;
  const metrics = run.metrics;
  const trades = run.trades ?? [];
  const netPnlClass = metrics && metrics.netProfit >= 0 ? "text-signal-up" : "text-signal-down";
  const overlaidOnThisChart = run.status === "completed" && run.symbol === activePaneSymbol;

  return (
    <div className="mt-2 space-y-2.5">
      {run.status === "failed" && (
        <div className="rounded-control border border-danger/30 bg-danger/10 px-2.5 py-2">
          <p className={`${FIN_LABEL} text-danger`}>Run failed{run.errorCode ? ` (${run.errorCode})` : ""}</p>
          <p className="mt-1 text-[11px] text-danger">{run.errorMessage ?? "No further detail was returned."}</p>
        </div>
      )}

      {run.status === "completed" && !overlaidOnThisChart && (
        <div className="rounded-control border border-dashed border-border bg-ink px-2.5 py-2">
          <p className="text-[11px] text-text-3">
            This strategy compiled for <span className="text-text-2">{run.symbol}</span>, not this pane&apos;s active symbol ({activePaneSymbol}) - results are shown below but not
            overlaid on this chart.
          </p>
        </div>
      )}

      <LifecycleSection lifecycle={run.lifecycle} />

      <CompiledStrategyCard strategy={run.compiledStrategy} strategyName={strategyName} run={run} />

      {run.status === "completed" && metrics && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
            <StatField label="Strategy">
              <span className={FIN_SECONDARY}>
                {strategyName}
                {run.strategyVersion ? ` v${run.strategyVersion}` : ""}
              </span>
            </StatField>
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
            {/* P4.4 audit finding, fixed: at24-quant-engine's own computeCoreMetrics() has always
                computed maxDrawdown as a PERCENTAGE (100 * (peak-equity)/peak - see metrics.ts's
                own formula doc comment), never currency - this was rendering that percentage
                through the currency formatter (e.g. showing "2.32" styled/labeled as a price) since
                P3.2B. formatPercent is the correct, real unit this field has always carried. */}
            <StatField label="Max Drawdown">
              <span className={FIN_SECONDARY}>{formatPercent(metrics.maxDrawdown, { signed: false })}</span>
            </StatField>
            <StatField label="Final Equity">
              <span className={FIN_PRIMARY}>{formatPrice(run.initialBalance + metrics.netProfit, { maxDecimals: 2 })}</span>
            </StatField>
          </div>

          <ParameterSnapshot run={run} />

          <ExecutionAssumptions assumptions={run.assumptions} />

          {run.equityCurve && run.equityCurve.length > 1 ? (
            <EquityCurveSparkline points={run.equityCurve} />
          ) : (
            <p className="text-[11px] text-text-3">No equity curve - the run produced fewer than 2 balance points.</p>
          )}

          <div className="overflow-x-auto">
            <p className={`${FIN_LABEL} mb-1`}>Trades ({trades.length})</p>
            {trades.length === 0 ? (
              <p className="text-[11px] text-text-3">
                0 trades in this window - a legitimate, reproducible result (see Evidence below), not necessarily an error. A strategy can be genuinely valid and simply never trigger
                within the tested range.
              </p>
            ) : (
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className={FIN_LABEL}>
                    <th className="pb-1 pr-2">#</th>
                    <th className="pb-1 pr-2">Side</th>
                    <th className="pb-1 pr-2">Entry</th>
                    <th className="pb-1 pr-2">Exit</th>
                    <th className="pb-1 pr-2">P&amp;L</th>
                    <th className="pb-1 pr-2">R</th>
                    <th className="pb-1 pr-2" title="Maximum Favorable Excursion - the best this trade ever looked, in R, before its actual exit">MFE</th>
                    <th className="pb-1 pr-2" title="Maximum Adverse Excursion - the worst this trade ever looked, in R, before its actual exit">MAE</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t, i) => (
                    <TradeRow key={t.tradeId} index={i + 1} trade={t} selected={t.tradeId === selectedTradeId} onSelect={() => onSelectTrade(t.tradeId === selectedTradeId ? null : t.tradeId)} />
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <AnalyticsSection analytics={run.analytics} />
        </>
      )}

      <RunIdentityCard run={run} />
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
      <td className={`py-1 pr-2 ${FIN_SECONDARY}`}>{trade.mfeR === null ? "—" : `${trade.mfeR.toFixed(2)}R`}</td>
      <td className={`py-1 pr-2 ${FIN_SECONDARY}`}>{trade.maeR === null ? "—" : `${trade.maeR.toFixed(2)}R`}</td>
    </tr>
  );
}

/**
 * P3.4 - the exact, persisted parameter snapshot this run executed with
 * (section 11: "the user must be able to determine exactly what
 * configuration produced the result"). `run.parameters === undefined`
 * covers two genuinely different, both-honest cases, told apart by
 * whether the strategy has ANY declared parameters at all: if it does,
 * undefined means "predates P3.4, no snapshot exists" (rendered as an
 * explicit note, never silently assumed to be today's defaults); if it
 * doesn't, there is nothing to show and nothing is rendered. P4.3 -
 * generalized off `run.compiledStrategy?.parameters` (real for either
 * strategy source) instead of a registry-only `strategyDef` prop.
 */
function ParameterSnapshot({ run }: { run: AlgoTestRunView }) {
  const declared = run.compiledStrategy?.parameters ?? [];
  if (declared.length === 0) return null;

  if (!run.parameters) {
    return (
      <div className="rounded-control border border-dashed border-border bg-ink px-2.5 py-2">
        <p className={FIN_LABEL}>Parameters</p>
        <p className="mt-1 text-[11px] text-text-3">Not recorded - this result predates P3.4 parameter tracking.</p>
      </div>
    );
  }

  const entries = Object.entries(run.parameters);
  if (entries.length === 0) return null;

  return (
    <div className="rounded-control border border-dashed border-border bg-ink px-2.5 py-2">
      <p className={FIN_LABEL}>Parameters</p>
      <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] sm:grid-cols-4">
        {entries.map(([id, value]) => {
          const def = declared.find((p) => p.key === id);
          return (
            <div key={id}>
              <dt className="text-text-3">{def?.key ?? id}</dt>
              <dd className="text-text-2">{String(value)}</dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

// ---------------------------------------------------------------------
// P4.4 (docs/P4.4-ADVANCED-ANALYTICS-FOUNDATION.md) - Advanced Analytics
// Foundation. Every component below renders ONLY real fields from
// run.analytics (algo-test-analytics.ts's own Tier 1 projections +
// at24-quant-engine's computeRiskRatios()) - no new local computation,
// no strategy-specific branch. null renders as an em dash, never a
// fabricated 0/blank. Deliberately plain, small, functional visuals
// (inline SVG, the same minimal aesthetic EquityCurveSparkline already
// established) - this phase is analytics functionality, not a visual
// overhaul.
// ---------------------------------------------------------------------

function AnalyticsSection({ analytics }: { analytics: AlgoTestAnalyticsView | undefined }) {
  if (!analytics) return null;
  return (
    <div className="space-y-2.5">
      <p className={FIN_LABEL}>Analytics</p>
      <RiskRatiosCard riskRatios={analytics.riskRatios} />
      <SideBreakdownCard sideBreakdown={analytics.sideBreakdown} />
      <PnlDistributionCard distribution={analytics.pnlDistribution} />
      <DurationVsPnlChart points={analytics.durationVsPnl} />
      <CalendarStrip days={analytics.calendar} />
    </div>
  );
}

function ratioText(v: number | null): string {
  return v === null ? "—" : v.toFixed(3);
}

/** Every field is at24-quant-engine's own computeRiskRatios() output, per-trade (not annualized), 0-risk-free-rate - see that function's own formula doc comment for the exact definition of each. */
function RiskRatiosCard({ riskRatios }: { riskRatios: AlgoTestAnalyticsView["riskRatios"] }) {
  return (
    <div className="rounded-control border border-dashed border-border bg-ink px-2.5 py-2">
      <p className={FIN_LABEL}>Risk Ratios (per-trade, 0% risk-free rate - not annualized)</p>
      <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] sm:grid-cols-5">
        <div>
          <dt className="text-text-3">Sharpe</dt>
          <dd className="text-text-2">{ratioText(riskRatios.sharpeRatio)}</dd>
        </div>
        <div>
          <dt className="text-text-3">Sortino</dt>
          <dd className="text-text-2">{ratioText(riskRatios.sortinoRatio)}</dd>
        </div>
        <div>
          <dt className="text-text-3">Calmar</dt>
          <dd className="text-text-2">{ratioText(riskRatios.calmarRatio)}</dd>
        </div>
        <div>
          <dt className="text-text-3">Recovery Factor</dt>
          <dd className="text-text-2">{ratioText(riskRatios.recoveryFactor)}</dd>
        </div>
        <div>
          <dt className="text-text-3">Ulcer Index</dt>
          <dd className="text-text-2">{ratioText(riskRatios.ulcerIndex)}</dd>
        </div>
      </dl>
      <p className="mt-1.5 text-[11px] text-text-3">An em dash means genuinely undefined for this run (too few trades, zero variance, zero drawdown, or no losing trades) - never a misleading 0.</p>
    </div>
  );
}

function SideBreakdownCard({ sideBreakdown }: { sideBreakdown: AlgoTestAnalyticsView["sideBreakdown"] }) {
  const { buy, sell } = sideBreakdown;
  return (
    <div className="rounded-control border border-dashed border-border bg-ink px-2.5 py-2">
      <p className={FIN_LABEL}>Side Breakdown</p>
      <table className="mt-1 w-full text-left text-[11px]">
        <thead>
          <tr className="text-text-3">
            <th className="pb-1 pr-2 font-normal"></th>
            <th className="pb-1 pr-2 font-normal">Trades</th>
            <th className="pb-1 pr-2 font-normal">Win Rate</th>
            <th className="pb-1 pr-2 font-normal">Net P&amp;L</th>
            <th className="pb-1 pr-2 font-normal">Avg P&amp;L</th>
          </tr>
        </thead>
        <tbody>
          {[buy, sell].map((s) => (
            <tr key={s.side} className="border-t border-border">
              <td className="py-1 pr-2">
                <Badge tone={s.side === "BUY" ? "success" : "danger"}>{s.side}</Badge>
              </td>
              <td className="py-1 pr-2 text-text-2">{s.tradeCount}</td>
              <td className="py-1 pr-2 text-text-2">{formatPercent(s.winRate, { signed: false })}</td>
              <td className={`py-1 pr-2 fin-num font-mono ${s.netPnl >= 0 ? "text-signal-up" : "text-signal-down"}`}>{formatPrice(s.netPnl, { maxDecimals: 2 })}</td>
              <td className="py-1 pr-2 text-text-2">{s.averagePnl === null ? "—" : formatPrice(s.averagePnl, { maxDecimals: 2 })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PnlDistributionCard({ distribution }: { distribution: AlgoTestAnalyticsView["pnlDistribution"] }) {
  const { winCount, lossCount, winSum, lossSum, winAverage, lossAverage, winMedian, lossMedian, buckets } = distribution;
  return (
    <div className="rounded-control border border-dashed border-border bg-ink px-2.5 py-2">
      <p className={FIN_LABEL}>P&amp;L Distribution</p>
      <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] sm:grid-cols-4">
        <div>
          <dt className="text-text-3">Winners</dt>
          <dd className="text-signal-up">
            {winCount} &middot; {formatPrice(winSum, { maxDecimals: 2 })}
          </dd>
        </div>
        <div>
          <dt className="text-text-3">Losers</dt>
          <dd className="text-signal-down">
            {lossCount} &middot; {formatPrice(lossSum, { maxDecimals: 2 })}
          </dd>
        </div>
        <div>
          <dt className="text-text-3">Avg win / loss</dt>
          <dd className="text-text-2">
            {winAverage === null ? "—" : formatPrice(winAverage, { maxDecimals: 2 })} / {lossAverage === null ? "—" : formatPrice(lossAverage, { maxDecimals: 2 })}
          </dd>
        </div>
        <div>
          <dt className="text-text-3">Median win / loss</dt>
          <dd className="text-text-2">
            {winMedian === null ? "—" : formatPrice(winMedian, { maxDecimals: 2 })} / {lossMedian === null ? "—" : formatPrice(lossMedian, { maxDecimals: 2 })}
          </dd>
        </div>
      </dl>
      {buckets.length > 0 && <PnlHistogram buckets={buckets} />}
    </div>
  );
}

/** A plain inline-SVG bar histogram - the same minimal, no-library aesthetic EquityCurveSparkline already established. Bucket boundaries come straight from algo-test-analytics.ts's own buildPnlDistribution(), never recomputed here. */
function PnlHistogram({ buckets }: { buckets: AlgoTestAnalyticsView["pnlDistribution"]["buckets"] }) {
  const WIDTH = 560;
  const HEIGHT = 56;
  const GAP = 2;
  const maxCount = Math.max(...buckets.map((b) => b.count), 1);
  const barWidth = (WIDTH - GAP * (buckets.length - 1)) / buckets.length;
  return (
    <div className="mt-1.5">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-14 w-full" preserveAspectRatio="none" role="img" aria-label="P&amp;L distribution histogram">
        {buckets.map((b, i) => {
          const barHeight = (b.count / maxCount) * (HEIGHT - 2);
          const x = i * (barWidth + GAP);
          const positive = b.rangeStart >= 0;
          return <rect key={i} x={x} y={HEIGHT - barHeight} width={barWidth} height={barHeight} fill={positive ? "#3fb27f" : "#d1594a"} opacity={0.85} />;
        })}
      </svg>
    </div>
  );
}

/** A plain inline-SVG scatter - x = duration, y = P&L, one dot per trade. Real per-trade points from algo-test-analytics.ts's buildDurationVsPnl(), no aggregation. */
function DurationVsPnlChart({ points }: { points: AlgoTestAnalyticsView["durationVsPnl"] }) {
  if (points.length === 0) return null;
  const WIDTH = 560;
  const HEIGHT = 90;
  const PAD = 6;
  const maxDuration = Math.max(...points.map((p) => p.durationMs), 1);
  const maxAbsPnl = Math.max(...points.map((p) => Math.abs(p.pnl)), 1);
  return (
    <div className="rounded-control border border-dashed border-border bg-ink px-2.5 py-2">
      <p className={FIN_LABEL}>Duration vs. P&amp;L ({points.length} trade{points.length === 1 ? "" : "s"})</p>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="mt-1 h-[90px] w-full" preserveAspectRatio="none" role="img" aria-label="Duration versus P&amp;L scatter">
        <line x1={PAD} y1={HEIGHT / 2} x2={WIDTH - PAD} y2={HEIGHT / 2} stroke="#3a3f4c" strokeWidth={1} />
        {points.map((p) => {
          const x = PAD + (p.durationMs / maxDuration) * (WIDTH - PAD * 2);
          const y = HEIGHT / 2 - (p.pnl / maxAbsPnl) * (HEIGHT / 2 - PAD);
          return <circle key={p.tradeId} cx={x} cy={y} r={2.5} fill={p.pnl >= 0 ? "#3fb27f" : "#d1594a"} opacity={0.85} />;
        })}
      </svg>
      <p className="mt-1 text-[11px] text-text-3">Horizontal axis: trade duration (longer trades further right). Vertical axis: P&amp;L (winners above the line, losers below).</p>
    </div>
  );
}

const OUTCOME_COLOR: Readonly<Record<AlgoTestAnalyticsView["calendar"][number]["outcome"], string>> = {
  winning: "bg-signal-up/70",
  losing: "bg-signal-down/70",
  breakeven: "bg-text-3/50",
};

/**
 * A chronological strip of only the days that actually had trades - never
 * a full calendar-month grid with fabricated zero-trade cells (see
 * algo-test-analytics.ts's own buildCalendar() doc comment for why: a
 * grid would require inventing a date range to fill). A day absent from
 * this strip had zero trades.
 */
function CalendarStrip({ days }: { days: AlgoTestAnalyticsView["calendar"] }) {
  if (days.length === 0) return null;
  return (
    <div className="rounded-control border border-dashed border-border bg-ink px-2.5 py-2">
      <p className={FIN_LABEL}>Calendar ({days.length} trading day{days.length === 1 ? "" : "s"})</p>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {days.map((d) => (
          <div
            key={d.date}
            title={`${d.date}: ${d.tradeCount} trade${d.tradeCount === 1 ? "" : "s"}, ${formatPrice(d.netPnl, { maxDecimals: 2 })}`}
            className={`flex h-7 w-7 items-center justify-center rounded-control text-[9px] font-semibold text-ink ${OUTCOME_COLOR[d.outcome]}`}
          >
            {d.tradeCount}
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-text-3">Only days with at least one trade are shown, in order - any date not shown had zero trades this run.</p>
    </div>
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

// ---------------------------------------------------------------------
// P4.3 additions below - Validation/Evidence display, Compiled Strategy
// display, Run Identity display. Every one of these renders ONLY real,
// already-computed backend fields (StageResult/StrategySpec/hash
// strings) - none of them derive a new judgment or scoring system.
// ---------------------------------------------------------------------

type LifecycleVisualState = "passed" | "not-applicable" | "failed" | "not-reached";

const STAGE_LABEL: Readonly<Record<AlgoTestLifecycleStage, string>> = {
  IMPORTED: "Imported",
  PARSED: "Parsed",
  IR_VALID: "IR Valid",
  EXECUTION_VALID: "Execution Valid",
  DATA_VALID: "Data Valid",
  BACKTEST_VALID: "Backtest Valid",
  REPRODUCIBLE: "Reproducible",
  EVIDENCE_VERIFIED: "Evidence Verified",
};

const VISUAL_STATE_TONE: Readonly<Record<LifecycleVisualState, BadgeTone>> = {
  passed: "success",
  "not-applicable": "neutral",
  failed: "danger",
  "not-reached": "neutral",
};

const VISUAL_STATE_LABEL: Readonly<Record<LifecycleVisualState, string>> = {
  passed: "Passed",
  "not-applicable": "N/A",
  failed: "Failed",
  "not-reached": "Not reached",
};

/**
 * P4.3 - classifies every one of the 8 canonical stages into exactly one
 * of the 4 states the sprint spec requires (passed / failed / not
 * reached / unavailable is handled one level up, by LifecycleSection
 * itself when `lifecycle` is undefined). The real backend model only has
 * 3 StageOutcome values (PASSED/NOT_APPLICABLE/FAILED) - a "not reached"
 * stage is represented there as FAILED-with-a-cascade-detail (see
 * algo-test.service.ts's buildDataValidFailureLifecycle). This function
 * recovers the 4th, more precise state structurally, from stage ORDER
 * relative to `reachedStage` (P3.8's own documented invariant:
 * reachedStage stops at the LAST PASSED/NOT_APPLICABLE stage before any
 * failure) - never by pattern-matching the detail string, which could
 * change wording without notice.
 */
function classifyStage(lifecycle: AlgoTestLifecycleResult, stage: AlgoTestLifecycleStage): { state: LifecycleVisualState; detail?: string } {
  const stages = LIFECYCLE_STAGES;
  const reachedIdx = stages.indexOf(lifecycle.reachedStage);
  const stageIdx = stages.indexOf(stage);
  const result = lifecycle.stages.find((s) => s.stage === stage);

  if (stageIdx <= reachedIdx) {
    const state: LifecycleVisualState = result?.outcome === "NOT_APPLICABLE" ? "not-applicable" : "passed";
    return { state, detail: result?.detail };
  }
  if (stageIdx === reachedIdx + 1 && result?.outcome === "FAILED") {
    return { state: "failed", detail: result.detail };
  }
  return { state: "not-reached" };
}

function LifecycleSection({ lifecycle }: { lifecycle: AlgoTestLifecycleResult | undefined }) {
  if (!lifecycle) {
    return (
      <div className="rounded-control border border-dashed border-border bg-ink px-2.5 py-2">
        <p className={FIN_LABEL}>Validation &amp; Evidence</p>
        <p className="mt-1 text-[11px] text-text-3">
          Unavailable - this run predates lifecycle/evidence persistence (see docs/P4.5-STRATEGY-RUN-IDENTITY-PERSISTENCE.md). Re-run to record it.
        </p>
      </div>
    );
  }

  const executionValid = classifyStage(lifecycle, "EXECUTION_VALID").state === "passed" || classifyStage(lifecycle, "EXECUTION_VALID").state === "not-applicable";

  return (
    <div className="rounded-control border border-border bg-ink px-2.5 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={FIN_LABEL}>Validation &amp; Evidence</p>
        <div className="flex gap-1.5">
          {/* The spec's own required distinction: "Valid" (passed required technical validation) is NOT the same claim as "Evidence Verified" (a reproducible, evidence-qualified result) - two real, separately-computed milestones, never one merged trust score. */}
          <Badge tone={executionValid ? "info" : "neutral"}>{executionValid ? "Strategy Valid" : "Not Valid"}</Badge>
          <Badge tone={lifecycle.fullyVerified ? "success" : "neutral"}>{lifecycle.fullyVerified ? "Evidence Verified" : "Not Evidence-Verified"}</Badge>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {LIFECYCLE_STAGES.map((stage) => {
          const { state, detail } = classifyStage(lifecycle, stage);
          return (
            <div key={stage} title={detail} className="flex items-center gap-1.5">
              <Badge tone={VISUAL_STATE_TONE[state]} className="shrink-0">
                {VISUAL_STATE_LABEL[state]}
              </Badge>
              <span className="truncate text-[11px] text-text-2">{STAGE_LABEL[stage]}</span>
            </div>
          );
        })}
      </div>
      {(() => {
        const failedStage = LIFECYCLE_STAGES.find((s) => classifyStage(lifecycle, s).state === "failed");
        if (!failedStage) return null;
        const { detail } = classifyStage(lifecycle, failedStage);
        return (
          <p className="mt-2 text-[11px] text-danger">
            Blocked at {STAGE_LABEL[failedStage]}: {detail}
          </p>
        );
      })()}
    </div>
  );
}

/**
 * P4.3 - the compiled StrategySpec (registry OR AI, same component),
 * projected server-side by toCompiledStrategyView(). Distinguishes
 * "unavailable because this run's lifecycle isn't available either" (a
 * reopen) from "no compiled strategy because compilation never reached a
 * valid, executable form" (a real failure) from simply not rendering
 * when a run genuinely never attempted to build one (a pure client-input
 * validation failure, empty testId).
 */
function CompiledStrategyCard({ strategy, strategyName, run }: { strategy: AlgoTestCompiledStrategyView | undefined; strategyName: string; run: AlgoTestRunView }) {
  if (strategy) {
    return (
      <div className="rounded-control border border-border bg-ink px-2.5 py-2">
        <p className={FIN_LABEL}>Compiled Strategy</p>
        <p className={`${FIN_SECONDARY} mt-1`}>
          {strategy.name} <span className="text-text-3">v{strategy.version}</span>
        </p>
        <dl className="mt-1.5 grid grid-cols-1 gap-x-3 gap-y-1 text-[11px] sm:grid-cols-2">
          {/* run.symbol/.timeframe, NOT strategy.symbol/.timeframe - see AlgoTestCompiledStrategyView's own doc comment for why (a registry strategy's real StrategySpec can carry an internal fixture identity here, unrelated to what it actually traded). */}
          <Field label="Symbol / Timeframe" value={run.symbol && run.timeframe ? `${run.symbol} · ${timeframeLabel(run.timeframe)}` : undefined} />
          <Field label="Position sizing" value={strategy.positionSizing} />
          <Field label="Long entry" value={strategy.longEntry} />
          <Field label="Short entry" value={strategy.shortEntry} />
          <Field label="Exit" value={strategy.exit} span />
          <Field label="Stop loss" value={strategy.stopLoss} />
          <Field label="Take profit" value={strategy.takeProfit} />
        </dl>
        {strategy.parameters.length > 0 && (
          <div className="mt-1.5">
            <p className="text-[11px] text-text-3">Relevant parameters</p>
            <dl className="mt-0.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] sm:grid-cols-4">
              {strategy.parameters.map((p) => (
                <div key={p.key}>
                  <dt className="text-text-3">{p.key}</dt>
                  <dd className="text-text-2">{String(p.defaultValue)}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
    );
  }

  // No compiled strategy - work out WHY, honestly, rather than showing
  // a generic blank.
  if (run.testId === "") return null; // never even attempted - the top-level `error` banner already covers this
  if (!run.lifecycle) {
    return (
      <div className="rounded-control border border-dashed border-border bg-ink px-2.5 py-2">
        <p className={FIN_LABEL}>Compiled Strategy</p>
        <p className="mt-1 text-[11px] text-text-3">Unavailable - this run predates compiled-strategy persistence (see the Validation &amp; Evidence note above).</p>
      </div>
    );
  }
  return (
    <div className="rounded-control border border-dashed border-danger/30 bg-danger/10 px-2.5 py-2">
      <p className={`${FIN_LABEL} text-danger`}>Compiled Strategy</p>
      <p className="mt-1 text-[11px] text-danger">
        {strategyName} did not reach a valid, executable form - see Validation &amp; Evidence above for the real reason.
      </p>
    </div>
  );
}

function Field({ label, value, span }: { label: string; value: string | undefined; span?: boolean }) {
  return (
    <div className={span ? "sm:col-span-2" : undefined}>
      <dt className="text-text-3">{label}</dt>
      <dd className="text-text-2">{value ?? "—"}</dd>
    </div>
  );
}

/**
 * P4.3 (section 10) - the existing semantic/result hashing machinery,
 * surfaced, never a new identity system. Every value here is either
 * present verbatim from the backend or an explicit "—".
 */
function RunIdentityCard({ run }: { run: AlgoTestRunView }) {
  if (run.testId === "") return null;
  return (
    <div className="rounded-control border border-dashed border-border bg-ink px-2.5 py-2">
      <p className={FIN_LABEL}>Run Identity</p>
      <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] sm:grid-cols-4">
        <div>
          <dt className="text-text-3">Run ID</dt>
          <dd className="truncate font-mono text-text-2" title={run.testId}>
            {run.testId}
          </dd>
        </div>
        <div>
          <dt className="text-text-3">Strategy Hash</dt>
          <dd className="truncate font-mono text-text-2" title={run.strategyHash}>
            {run.strategyHash ? `${run.strategyHash.slice(0, 16)}…` : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-text-3">Result Hash</dt>
          <dd className="truncate font-mono text-text-2" title={run.resultHash}>
            {run.resultHash ? `${run.resultHash.slice(0, 16)}…` : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-text-3">Evidence Status</dt>
          <dd className="text-text-2">{run.lifecycle ? (run.lifecycle.fullyVerified ? "Verified" : `Reached ${STAGE_LABEL[run.lifecycle.reachedStage]}`) : "—"}</dd>
        </div>
      </dl>
    </div>
  );
}
