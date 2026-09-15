// lib/algo-test/walk-forward-store.ts
// P4.9-C.2 - thin client fetch wrapper over /api/private/algo-test/walk-forward,
// mirroring lib/algo-test/optimization-store.ts's own established shape
// exactly (parseErrorMessage/parseApiError, a typed client-error class
// carrying the real server code, get-never-throws vs.
// create/continue/cancel-throw). Deliberately a separate file - the same
// file-split reasoning already locked for
// optimization.service.ts/walk-forward.service.ts and their own type
// modules, extended here to the client layer for consistency.
//
// This file is a pure HTTP boundary: no business logic, no verdict
// computation, no winner computation - every value it returns is read
// verbatim from the server response and handed to the caller unchanged.
import type { CreateWalkForwardExperimentRequest, WalkForwardExperimentDetailView, WalkForwardExperimentView } from "@/types/walk-forward";

const BASE = "/api/private/algo-test/walk-forward";

async function parseErrorMessage(res: Response): Promise<string> {
  try {
    const json = await res.json();
    return json?.error?.message ?? `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

/**
 * Mirrors OptimizationClientError exactly - the real server-supplied
 * `code` (verbatim from WalkForwardServiceError, e.g. "PROVIDER_ERROR"/
 * "NOT_FOUND") is carried on this error rather than only its message, so
 * the Monitor page's polling loop can branch on err.code === "PROVIDER_ERROR"
 * specifically, the same distinction Optimization's own polling loop
 * already relies on.
 */
export class WalkForwardClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WalkForwardClientError";
  }
}

async function parseApiError(res: Response): Promise<WalkForwardClientError> {
  try {
    const json = await res.json();
    return new WalkForwardClientError(json?.error?.code ?? "UNKNOWN", json?.error?.message ?? `Request failed (${res.status})`);
  } catch {
    return new WalkForwardClientError("UNKNOWN", `Request failed (${res.status})`);
  }
}

export async function createWalkForwardExperiment(request: CreateWalkForwardExperimentRequest): Promise<WalkForwardExperimentView> {
  const res = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  const json = await res.json();
  return json.data.experiment as WalkForwardExperimentView;
}

/**
 * Mirrors fetchOptimizationExperiment() exactly - never throws;
 * `undefined` covers both a genuine 404 (not found / not owned) and any
 * transient fetch failure, which the Monitor page does not need to
 * distinguish (it shows one real ErrorState either way). Returns the
 * DETAIL shape (folds + candidates) - unlike Optimization, the WFO Monitor
 * page needs fold/candidate visibility continuously while RUNNING, not
 * only once at the end, so this is the only fetch function the page's
 * polling loop uses to refresh its displayed state (see the page's own
 * header comment for why continue()'s own lightweight response is not
 * enough on its own).
 */
export async function fetchWalkForwardExperiment(experimentId: string): Promise<WalkForwardExperimentDetailView | undefined> {
  try {
    const res = await fetch(`${BASE}/${encodeURIComponent(experimentId)}`);
    if (!res.ok) return undefined;
    const json = await res.json();
    return json?.data?.experiment as WalkForwardExperimentDetailView | undefined;
  } catch {
    return undefined;
  }
}

/**
 * One chunk of real, bounded server-side work (mirrors
 * continueOptimizationExperiment() exactly) - throws WalkForwardClientError
 * (never a plain Error) so the Monitor page's polling loop can branch on
 * err.code === "PROVIDER_ERROR" specifically. Returns only the lightweight
 * summary shape (no folds) - the caller re-fetches full detail via
 * fetchWalkForwardExperiment() afterward for fold/candidate display.
 */
export async function continueWalkForwardExperiment(experimentId: string): Promise<WalkForwardExperimentView> {
  const res = await fetch(`${BASE}/${encodeURIComponent(experimentId)}/continue`, { method: "POST" });
  if (!res.ok) throw await parseApiError(res);
  const json = await res.json();
  return json.data.experiment as WalkForwardExperimentView;
}

/**
 * Atomic QUEUED/RUNNING -> CANCELLED. Mirrors cancelOptimizationExperiment()
 * exactly - throws WalkForwardClientError on failure (the only realistic
 * failure modes are NOT_FOUND or a transient transport failure, both worth
 * surfacing to the caller rather than silently swallowed).
 */
export async function cancelWalkForwardExperiment(experimentId: string): Promise<WalkForwardExperimentView> {
  const res = await fetch(`${BASE}/${encodeURIComponent(experimentId)}/cancel`, { method: "POST" });
  if (!res.ok) throw await parseApiError(res);
  const json = await res.json();
  return json.data.experiment as WalkForwardExperimentView;
}
