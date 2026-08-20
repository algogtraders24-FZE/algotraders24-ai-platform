// lib/chart-engine/drawing/store.ts
// Sprint D2.7.11 Phase 1b - durable persistence for drawn chart objects.
// Previously sessionStorage (tab-scoped, gone on tab close) - now backed by
// a real per-user DB table (ChartDrawingSet) via GET/PUT
// /api/private/chart-drawings, so a trend line drawn today is still there
// tomorrow, on any device - matching MT5's own real per-chart saved
// objects. This was an explicit open design decision in the roadmap doc
// (new Prisma model vs extending WorkspacePreference) - resolved in favor
// of a dedicated table, since WorkspacePreference is a flat one-row-per-
// user model with no per-symbol/per-timeframe dimension at all.
//
// Every read is re-validated field-by-field via isValidDrawingObject
// (never trusted blindly) - same discipline this file always followed,
// now guarding a possibly-stale/malformed server response instead of a
// corrupted sessionStorage value.
//
// Writes for the SAME (symbol, timeframe) key are serialized through a
// module-level per-key promise queue - async network calls can resolve
// out of order, and without this, a rapid add-then-delete could have its
// two PUT requests land at the server in the WRONG order, leaving a
// deleted object resurrected on the next read. Writes for DIFFERENT keys
// stay fully independent/concurrent.
import { isValidDrawingObject } from "./validation";
import type { DrawingObject } from "./types";

function storeKey(symbol: string, timeframe: string): string {
  return `${symbol}|${timeframe}`;
}

/** Never throws - a fetch failure, an unauthenticated caller, or a symbol/timeframe with nothing saved yet all honestly resolve to an empty array, exactly like the old sessionStorage read's own contract. */
export async function readDrawingObjects(symbol: string, timeframe: string, signal?: AbortSignal): Promise<DrawingObject[]> {
  try {
    const params = new URLSearchParams({ symbol, timeframe });
    const res = await fetch(`/api/private/chart-drawings?${params.toString()}`, { signal });
    if (!res.ok) return [];
    const json = await res.json();
    const raw = json?.data?.objects;
    if (!Array.isArray(raw)) return [];
    return raw.filter(isValidDrawingObject);
  } catch {
    return [];
  }
}

const writeQueues = new Map<string, Promise<void>>();

async function putOnce(symbol: string, timeframe: string, objects: readonly DrawingObject[]): Promise<void> {
  try {
    await fetch("/api/private/chart-drawings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, timeframe, objects }),
    });
  } catch {
    // Best-effort - a failed/offline request never blocks or errors the
    // chart UI, same contract the old sessionStorage write always had.
  }
}

/** Best-effort write, queued per (symbol, timeframe) so out-of-order network resolution can never leave a stale value persisted (see header comment). */
export function writeDrawingObjects(symbol: string, timeframe: string, objects: readonly DrawingObject[]): Promise<void> {
  const key = storeKey(symbol, timeframe);
  const previous = writeQueues.get(key) ?? Promise.resolve();
  const next = previous.then(() => putOnce(symbol, timeframe, objects));
  writeQueues.set(key, next);
  return next;
}
