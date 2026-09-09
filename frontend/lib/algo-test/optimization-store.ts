// lib/algo-test/optimization-store.ts
// P4.9-A.4-T1/T2 (docs/P4.9-A4-UI-CONTRACT.md, docs/P4.9-OPTIMIZATION-WFO.md's
// own A.4-T2-R1 lock) - thin client fetch wrapper over
// /api/private/algo-test/optimization, mirroring lib/algo-test/store.ts's
// own established shape exactly (parseErrorMessage, throw-with-real-server-
// message on mutation). Deliberately a separate file from store.ts - the
// same file-split reasoning already locked for
// optimization.service.ts/types/optimization.ts in A.2/A.3, extended here
// to the client layer for consistency.
//
// T2 adds get/continue. cancel is still not added (its own later tier).
import type { CreateOptimizationExperimentRequest, OptimizationExperimentDetailView, OptimizationExperimentView } from "@/types/optimization";

const BASE = "/api/private/algo-test/optimization";

async function parseErrorMessage(res: Response): Promise<string> {
  try {
    const json = await res.json();
    return json?.error?.message ?? `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

/**
 * P4.9-A.4-T2-R1 lock (#9) - continueOptimizationExperiment() must let a
 * caller distinguish PROVIDER_ERROR (pause polling, offer Retry) from any
 * other failure. The real server-supplied `code` (verbatim from
 * OptimizationServiceError, e.g. "PROVIDER_ERROR"/"NOT_FOUND") is carried
 * on this error rather than only its message - a generic Error (as
 * runAlgoTest()/createOptimizationExperiment()'s own throw convention
 * uses) would lose that distinction.
 */
export class OptimizationClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "OptimizationClientError";
  }
}

async function parseApiError(res: Response): Promise<OptimizationClientError> {
  try {
    const json = await res.json();
    return new OptimizationClientError(json?.error?.code ?? "UNKNOWN", json?.error?.message ?? `Request failed (${res.status})`);
  } catch {
    return new OptimizationClientError("UNKNOWN", `Request failed (${res.status})`);
  }
}

export async function createOptimizationExperiment(request: CreateOptimizationExperimentRequest): Promise<OptimizationExperimentView> {
  const res = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  const json = await res.json();
  return json.data.experiment as OptimizationExperimentView;
}

/**
 * P4.9-A.4-T2-R1 lock (#2) - the Monitor page's own first call, before any
 * continue(). Never throws (mirrors fetchAlgoTestRun()/fetchStrategyLibraryDetail()'s
 * own never-throws convention exactly) - `undefined` covers both a
 * genuine 404 (not found / not owned) and any transient fetch failure on
 * initial load; the page cannot and does not need to distinguish them
 * (same reasoning those two existing wrappers already establish) - it
 * shows one real ErrorState either way, per the locked UI contract.
 */
export async function fetchOptimizationExperiment(experimentId: string): Promise<OptimizationExperimentDetailView | undefined> {
  try {
    const res = await fetch(`${BASE}/${encodeURIComponent(experimentId)}`);
    if (!res.ok) return undefined;
    const json = await res.json();
    return json?.data?.experiment as OptimizationExperimentDetailView | undefined;
  } catch {
    return undefined;
  }
}

/**
 * P4.9-A.4-T2-R1 lock - one chunk. Throws OptimizationClientError (never a
 * plain Error) so the Monitor page's polling loop can branch on
 * err.code === "PROVIDER_ERROR" specifically (lock #9) vs. any other
 * failure.
 */
export async function continueOptimizationExperiment(experimentId: string): Promise<OptimizationExperimentView> {
  const res = await fetch(`${BASE}/${encodeURIComponent(experimentId)}/continue`, { method: "POST" });
  if (!res.ok) throw await parseApiError(res);
  const json = await res.json();
  return json.data.experiment as OptimizationExperimentView;
}
