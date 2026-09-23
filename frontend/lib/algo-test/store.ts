// lib/algo-test/store.ts
// P3.2B - thin client fetch wrapper over /api/private/algo-test/*, the
// same "thin wrapper, mutation functions throw with a real message" shape
// lib/paper-trading/store.ts already establishes.
import type { AiCompileAndRunRequest, AlgoTestRunRequest, AlgoTestRunView, AlgoTestStrategyDefinition, StrategyLibraryDetail, StrategyLibraryItem } from "@/types/algo-test";
import type { QuantChatConversationState, QuantChatModificationKind } from "@/types/quant-chat";
import type { CompileNaturalLanguageStrategyResult } from "@/services/algo-test/nl-strategy-compiler.service";
import type { QuantChatPreviewData } from "@/services/algo-test/quant-chat-preview.service";
import type { CompiledStrategySummary } from "@/services/algo-test/nl-strategy-compiler-summary";
import type { LiveExecutionTickResult } from "@/services/algo-test/live-execution/live-execution.service";
import type { StrategySpec } from "at24-quant-engine";

const BASE = "/api/private/algo-test";

async function parseErrorMessage(res: Response): Promise<string> {
  try {
    const json = await res.json();
    return json?.error?.message ?? `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

export async function runAlgoTest(request: AlgoTestRunRequest): Promise<AlgoTestRunView> {
  const res = await fetch(`${BASE}/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  const json = await res.json();
  return json.data.run as AlgoTestRunView;
}

export async function fetchAlgoTestRun(testId: string): Promise<AlgoTestRunView | undefined> {
  try {
    const res = await fetch(`${BASE}/runs/${encodeURIComponent(testId)}`);
    if (!res.ok) return undefined;
    const json = await res.json();
    return json?.data?.run as AlgoTestRunView | undefined;
  } catch {
    return undefined;
  }
}

/** P3.3 - the Strategy Registry's available strategies, for registry-backed config UI. Never throws - an empty array (rather than an error) is the honest "nothing usable yet" state for a picker to render. */
export async function fetchAlgoTestStrategies(): Promise<AlgoTestStrategyDefinition[]> {
  try {
    const res = await fetch(`${BASE}/strategies`);
    if (!res.ok) return [];
    const json = await res.json();
    return (json?.data?.strategies as AlgoTestStrategyDefinition[] | undefined) ?? [];
  } catch {
    return [];
  }
}

/**
 * P4.7-T1 (docs/P4.7-RUN-HISTORY.md) - the authenticated user's own runs,
 * most recent first, from the already-real `GET /api/private/algo-test/runs`
 * (no new API surface - this is the first client-side consumer of that
 * endpoint). Mirrors `fetchAlgoTestStrategies()`'s own never-throws
 * convention exactly: an empty array (never a thrown error) is the
 * honest "nothing to show yet / a transient fetch failure" state for a
 * list to render - the same reasoning already applied to the strategy
 * picker. Server-side pagination stays fixed at 50 rows (unchanged) -
 * this wrapper does not add pagination, filtering, or sorting.
 */
export async function fetchAlgoTestRuns(): Promise<AlgoTestRunView[]> {
  try {
    const res = await fetch(`${BASE}/runs`);
    if (!res.ok) return [];
    const json = await res.json();
    return (json?.data?.runs as AlgoTestRunView[] | undefined) ?? [];
  } catch {
    return [];
  }
}

/**
 * P4.3 (docs/P4.3-SURFACE-THE-FOUNDATION.md) - the existing P4.2 AI-run
 * endpoint (POST /api/private/algo-test/ai-runs), a thin wrapper matching
 * runAlgoTest's own shape exactly - not a second, parallel AI execution
 * path. Throws with the real server-supplied message on a genuine
 * transport/auth/503 failure (e.g. ANTHROPIC_API_KEY not configured); a
 * compile/validation/backtest failure that the server DID handle comes
 * back as a normal 200/201 AlgoTestRunView with status:"failed" and a
 * real errorMessage - identical to runAlgoTest's own failure contract -
 * never thrown for that case.
 */
export async function compileAndRunAiStrategy(request: AiCompileAndRunRequest): Promise<AlgoTestRunView> {
  const res = await fetch(`${BASE}/ai-runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  const json = await res.json();
  return json.data.run as AlgoTestRunView;
}

/**
 * QP-2 - Conversational Strategy Builder's own thin client wrapper, same
 * "thin wrapper, throw with a real message" shape as every function above.
 * Deliberately calls /strategy-builder, never /ai-runs - this never
 * backtests (locked QP-2 scope).
 */
export interface StrategyBuilderModificationResult {
  state: QuantChatConversationState;
  run: CompileNaturalLanguageStrategyResult;
  modificationKind: QuantChatModificationKind;
  /** QP-3 - best-effort chart-preview data; undefined whenever compilation failed or the preview genuinely couldn't be built (a provider hiccup, e.g.) - never a stale/fabricated preview. */
  preview?: QuantChatPreviewData;
}

export async function applyStrategyBuilderModification(userText: string, state: QuantChatConversationState): Promise<StrategyBuilderModificationResult> {
  const res = await fetch(`${BASE}/strategy-builder`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userText, state }),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  const json = await res.json();
  return json.data as StrategyBuilderModificationResult;
}

/**
 * P4.8-T3.4.2 (docs/P4.8-T3-STRATEGY-LIBRARY.md) - GET /strategy-library,
 * already real since T3.3, gaining its first client-side consumer here.
 * Mirrors fetchAlgoTestRuns()'s own never-throws convention exactly: an
 * empty array is the honest "nothing usable yet / a transient fetch
 * failure" state for a list to render - the same reasoning already
 * applied to Run History (P4.7) and the strategy picker.
 */
export async function fetchStrategyLibrary(): Promise<StrategyLibraryItem[]> {
  try {
    const res = await fetch(`${BASE}/strategy-library`);
    if (!res.ok) return [];
    const json = await res.json();
    return (json?.data?.strategies as StrategyLibraryItem[] | undefined) ?? [];
  } catch {
    return [];
  }
}

/**
 * P4.8-T3.4.2 - GET /strategy-library/[strategyId], first client-side
 * consumer. Mirrors fetchAlgoTestRun()'s own never-throws convention -
 * `undefined` covers both "genuinely not found" (the route's own real
 * 404) and any transient fetch failure; the detail page cannot and does
 * not need to distinguish them (same reasoning as fetchAlgoTestRun()).
 */
export async function fetchStrategyLibraryDetail(strategyId: string): Promise<StrategyLibraryDetail | undefined> {
  try {
    const res = await fetch(`${BASE}/strategy-library/${encodeURIComponent(strategyId)}`);
    if (!res.ok) return undefined;
    const json = await res.json();
    return json?.data?.strategy as StrategyLibraryDetail | undefined;
  } catch {
    return undefined;
  }
}

/** Live Execution (Paper) - Phase 1. Compile-only, same POST /compile route the natural-language compiler has always exposed - never runs a backtest, never opens a position. */
export async function compileStrategyForLiveExecution(intent: string): Promise<CompiledStrategySummary> {
  const res = await fetch(`${BASE}/compile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intent }),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  const json = await res.json();
  return json.data.compilation as CompiledStrategySummary;
}

/** Live Execution (Paper) - Phase 1. One evaluation cycle: fetch fresh bars, decide, maybe open/close a paper position. The CALLER (LiveExecutionClient.tsx) owns the polling interval - this is a single, stateless request every tick, matching the route's own "no server-side running state" design. */
export async function tickLiveExecution(spec: StrategySpec): Promise<LiveExecutionTickResult> {
  const res = await fetch(`${BASE}/live-execution/tick`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ spec }),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  const json = await res.json();
  return json.data.result as LiveExecutionTickResult;
}
