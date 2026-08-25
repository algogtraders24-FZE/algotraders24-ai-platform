// lib/chart-engine/chart-workspace-layout-store.ts
// Sprint D2.7.11 (post-completion, roadmap item 2) - durable persistence
// for the Phase 3 multi-symbol tiled layout. Previously sessionStorage
// only (chart-session-state.ts - tab-scoped, gone on tab close/new
// device) - now backed by a real per-user DB table (ChartWorkspaceLayout)
// via GET/PUT /api/private/chart-workspace-layout, so a tiled workspace
// set up today is still there tomorrow, on any device - matching the
// exact Phase 1 -> 1b precedent lib/chart-engine/drawing/store.ts already
// established for drawn objects.
//
// Writes are serialized through a single module-level promise queue (only
// one row per user, unlike drawings' per symbol+timeframe key, so one
// queue is enough) - the same "out-of-order network resolution must never
// leave a stale value persisted" reasoning drawing/store.ts's own queue
// already documents.
import type { ChartSessionState } from "./chart-session-state";

/** Never throws - a fetch failure, an unauthenticated caller, or a user with nothing saved yet all honestly resolve to `{}`, exactly like readChartSessionState()'s own sessionStorage-read contract. */
export async function readChartWorkspaceLayout(signal?: AbortSignal): Promise<ChartSessionState> {
  try {
    const res = await fetch("/api/private/chart-workspace-layout", { signal });
    if (!res.ok) return {};
    const json = await res.json();
    const state = json?.data?.state;
    return state && typeof state === "object" ? (state as ChartSessionState) : {};
  } catch {
    return {};
  }
}

let writeQueue: Promise<void> = Promise.resolve();

async function putOnce(state: ChartSessionState): Promise<void> {
  try {
    await fetch("/api/private/chart-workspace-layout", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    });
  } catch {
    // Best-effort - a failed/offline request never blocks or errors the
    // chart UI, same contract the old sessionStorage write always had.
  }
}

/** Best-effort write, queued so out-of-order network resolution can never leave a stale value persisted. */
export function writeChartWorkspaceLayout(state: ChartSessionState): Promise<void> {
  const next = writeQueue.then(() => putOnce(state));
  writeQueue = next;
  return next;
}
