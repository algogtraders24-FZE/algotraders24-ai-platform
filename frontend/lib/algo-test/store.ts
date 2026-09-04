// lib/algo-test/store.ts
// P3.2B - thin client fetch wrapper over /api/private/algo-test/*, the
// same "thin wrapper, mutation functions throw with a real message" shape
// lib/paper-trading/store.ts already establishes.
import type { AiCompileAndRunRequest, AlgoTestRunRequest, AlgoTestRunView, AlgoTestStrategyDefinition } from "@/types/algo-test";

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
