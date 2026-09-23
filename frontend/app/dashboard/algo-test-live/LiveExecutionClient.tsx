"use client";
// app/dashboard/algo-test-live/LiveExecutionClient.tsx
// Live Execution (Paper) - Phase 1. Owner-directed minimal scope: this
// component IS the "server" - the setInterval below is the only trigger
// mechanism for the whole feature, deliberately (no new cron, no new
// Agent Framework tool/permission; see services/algo-test/live-execution/
// live-execution.service.ts's own header for the full design rationale).
// Closing or refreshing this tab genuinely stops execution.
//
// Reuses, never duplicates: /api/private/algo-test/compile (the SAME
// natural-language compiler Quant Chat's Modify mode used, unaffected by
// PR #136's UI removal - only that page's own UI stopped calling it),
// explainStrategySpec (lib/ai/strategy-compiler/strategy-explainer.ts,
// the SAME deterministic, zero-LLM paraphrase QuantChatClient.tsx used to
// show), and lib/paper-trading/store.ts's fetchAccount() for the account
// summary panel.
import { useEffect, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import Alert from "@/components/ui/Alert";
import Badge from "@/components/ui/Badge";
import Textarea from "@/components/ui/Textarea";
import PageHeader from "@/components/ui/PageHeader";
import PromptSuggestions from "@/components/ai/PromptSuggestions";
import { liveExecutionPromptSuggestions } from "@/data/live-execution-prompts";
import { compileStrategyForLiveExecution, tickLiveExecution } from "@/lib/algo-test/store";
import { fetchAccount } from "@/lib/paper-trading/store";
import { explainStrategySpec } from "@/lib/ai/strategy-compiler/strategy-explainer";
import type { CompiledStrategySummary } from "@/services/algo-test/nl-strategy-compiler-summary";
import type { LiveExecutionTickResult, LiveExecutionAction } from "@/services/algo-test/live-execution/live-execution.service";
import type { PaperAccountSummary } from "@/types/paper-trading";

// Matches useChartCandles.ts's own POLL_INTERVAL_MS - the same cadence
// every other "live" surface on this platform already polls at, not a
// new, unproven interval.
const TICK_INTERVAL_MS = 20_000;
const LOG_LIMIT = 50;

interface LogEntry extends LiveExecutionTickResult {
  readonly id: string;
}

const ACTION_TONE: Record<LiveExecutionAction, "success" | "warning" | "danger" | "neutral"> = {
  opened: "success",
  closed: "warning",
  skipped: "danger",
  none: "neutral",
};

export default function LiveExecutionClient() {
  const [intent, setIntent] = useState("");
  const [compiling, setCompiling] = useState(false);
  const [compileError, setCompileError] = useState<string | null>(null);
  const [compilation, setCompilation] = useState<CompiledStrategySummary | null>(null);

  const [running, setRunning] = useState(false);
  const [tickError, setTickError] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [account, setAccount] = useState<PaperAccountSummary | undefined>(undefined);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Ticks are async and re-entrant-unsafe against a slow provider response
  // - a guard flag, not a queue, matching AlgoTestPanel.tsx's own
  // `submitting` single-flight convention for its Run Backtest button.
  const tickInFlightRef = useRef(false);

  useEffect(() => {
    fetchAccount().then(setAccount);
  }, []);

  // Stop-on-unmount - navigating away from this page must stop execution
  // exactly like closing the tab does (same "only while this surface is
  // actually active" guarantee stated in the warning banner below).
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  async function handleCompile() {
    setCompileError(null);
    setCompiling(true);
    try {
      const result = await compileStrategyForLiveExecution(intent);
      setCompilation(result);
      if (!result.strategy) {
        setCompileError(`Could not compile (reached ${result.reachedStage}): ${result.stages.find((s) => s.outcome === "FAILED")?.detail ?? "see stage detail"}`);
      }
    } catch (err) {
      setCompileError(err instanceof Error ? err.message : "Something went wrong compiling this strategy.");
    } finally {
      setCompiling(false);
    }
  }

  async function runTick(spec: NonNullable<CompiledStrategySummary["strategy"]>) {
    if (tickInFlightRef.current) return;
    tickInFlightRef.current = true;
    try {
      const result = await tickLiveExecution(spec);
      setTickError(null);
      setLog((prev) => [{ ...result, id: `${result.evaluatedAt}-${Math.random().toString(36).slice(2, 6)}` }, ...prev].slice(0, LOG_LIMIT));
      if (result.action === "opened" || result.action === "closed") {
        fetchAccount().then(setAccount);
      }
    } catch (err) {
      setTickError(err instanceof Error ? err.message : "Tick failed.");
    } finally {
      tickInFlightRef.current = false;
    }
  }

  function handleStart() {
    const spec = compilation?.strategy;
    if (!spec || running) return;
    setRunning(true);
    void runTick(spec); // fire immediately, don't make the first check wait a full interval
    intervalRef.current = setInterval(() => void runTick(spec), TICK_INTERVAL_MS);
  }

  function handleStop() {
    setRunning(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  const symbol = compilation?.strategy?.instruments[0]?.symbol;
  const openPosition = account?.positions.find((p) => p.symbol === symbol && p.status === "open");

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Algo Testing Pro" title="Live Execution (Paper)" description="Describe a strategy, compile it, then let it run automatically against your simulated paper-trading account." />

      <Alert tone="warning">
        This only runs while THIS browser tab stays open and active - closing or refreshing the tab stops execution immediately, nothing keeps running in the background. Paper trading only: simulated balance, no real money is ever involved.
      </Alert>

      {!running && (
        <div className="space-y-3 rounded-card border border-border bg-ink-2 p-5">
          <label htmlFor="live-exec-intent" className="block text-sm font-medium text-text">
            Describe your strategy
          </label>
          <Textarea
            id="live-exec-intent"
            rows={4}
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            placeholder="Buy XAUUSD on the 1H when EMA(9) crosses above EMA(21). Stop loss 5, take profit 2R, quantity 1."
            disabled={compiling}
          />
          <p className="text-xs text-text-3">Only fixed-quantity position sizing is supported for live execution right now - name a specific quantity, not a percentage of equity.</p>
          <PromptSuggestions onPick={setIntent} suggestions={liveExecutionPromptSuggestions} />
          {compileError && <Alert tone="danger">{compileError}</Alert>}
          <Button onClick={handleCompile} loading={compiling} disabled={!intent.trim()}>
            Compile
          </Button>
        </div>
      )}

      {compilation?.strategy && (
        <div className="space-y-3 rounded-card border border-border bg-ink-2 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text">Compiled strategy</h2>
            <Badge tone="success">{compilation.reachedStage}</Badge>
          </div>
          <pre className="whitespace-pre-wrap rounded-control border border-border/60 bg-ink-3 p-3 text-xs text-text-2">{explainStrategySpec(compilation.strategy)}</pre>

          {!running ? (
            <Button onClick={handleStart}>Start (paper trading)</Button>
          ) : (
            <Button variant="secondary" onClick={handleStop}>
              Stop
            </Button>
          )}
          {running && <p className="text-xs text-success">Running - checking every 20 seconds while this tab stays open.</p>}
        </div>
      )}

      {account && (
        <div className="rounded-card border border-border bg-ink-2 p-5">
          <h2 className="mb-2 text-sm font-semibold text-text">Paper account</h2>
          <p className="text-xs text-text-3">
            Balance: {account.balance.toFixed(2)} · Used margin: {account.usedMargin.toFixed(2)}
          </p>
          {openPosition && (
            <p className="mt-1 text-xs text-text-2">
              Open position: {openPosition.side.toUpperCase()} {openPosition.quantity} {openPosition.symbol} @ {openPosition.entryPrice}
            </p>
          )}
        </div>
      )}

      {tickError && <Alert tone="danger">{tickError}</Alert>}

      {log.length > 0 && (
        <div className="rounded-card border border-border bg-ink-2 p-5">
          <h2 className="mb-2 text-sm font-semibold text-text">Activity log</h2>
          <ul className="space-y-1.5 text-xs">
            {log.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-2 border-b border-border/40 pb-1.5 last:border-0">
                <Badge tone={ACTION_TONE[entry.action]}>{entry.action}</Badge>
                <span className="text-text-3">{new Date(entry.evaluatedAt).toLocaleTimeString()}</span>
                <span className="text-text-2">{entry.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
