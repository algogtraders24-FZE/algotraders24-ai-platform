// lib/paper-trading/store.ts
// Paper Trading Engine, Phase P1 - thin client fetch wrappers over
// /api/private/paper-trading/*. Discrete-mutation state (open one
// position, close one position, reset), not continuous state like chart
// drawings/layout - so no write-queue is needed, unlike
// chart-workspace-layout-store.ts. `fetchAccount` never throws (a fetch
// failure or unauthenticated caller both honestly resolve to `undefined`,
// same "last good data keeps showing" contract useLiveQuote/
// useChartCandles already establish); the mutation functions DO throw
// (the caller needs the real error - "insufficient margin", "no real
// bid/ask" - to show the user, not a silently-swallowed failure).
import type { PaperAccountSummary, PaperPositionView, OpenPositionInput } from "@/types/paper-trading";

const BASE = "/api/private/paper-trading";

export async function fetchAccount(signal?: AbortSignal): Promise<PaperAccountSummary | undefined> {
  try {
    const res = await fetch(`${BASE}/account`, { signal });
    if (!res.ok) return undefined;
    const json = await res.json();
    return json?.data?.summary as PaperAccountSummary | undefined;
  } catch {
    return undefined;
  }
}

async function parseErrorMessage(res: Response): Promise<string> {
  try {
    const json = await res.json();
    return json?.error?.message ?? `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

export async function openPosition(input: OpenPositionInput): Promise<PaperPositionView> {
  const res = await fetch(`${BASE}/positions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  const json = await res.json();
  return json.data.position as PaperPositionView;
}

export async function closePosition(id: string): Promise<PaperPositionView> {
  const res = await fetch(`${BASE}/positions/${encodeURIComponent(id)}/close`, { method: "POST" });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  const json = await res.json();
  return json.data.position as PaperPositionView;
}

export async function resetAccount(): Promise<PaperAccountSummary> {
  const res = await fetch(`${BASE}/account/reset`, { method: "POST" });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  const json = await res.json();
  return json.data.summary as PaperAccountSummary;
}
