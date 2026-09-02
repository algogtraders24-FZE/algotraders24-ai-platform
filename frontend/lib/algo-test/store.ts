// lib/algo-test/store.ts
// P3.2B - thin client fetch wrapper over /api/private/algo-test/*, the
// same "thin wrapper, mutation functions throw with a real message" shape
// lib/paper-trading/store.ts already establishes.
import type { AlgoTestRunRequest, AlgoTestRunView } from "@/types/algo-test";

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
