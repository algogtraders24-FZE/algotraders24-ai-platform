// lib/algo-test/optimization-store.ts
// P4.9-A.4-T1 (docs/P4.9-A4-UI-CONTRACT.md) - thin client fetch wrapper
// over /api/private/algo-test/optimization, mirroring
// lib/algo-test/store.ts's own established shape exactly (parseErrorMessage,
// throw-with-real-server-message on mutation). Deliberately a separate
// file from store.ts - the same file-split reasoning already locked for
// optimization.service.ts/types/optimization.ts in A.2/A.3, extended here
// to the client layer for consistency.
//
// T1 is scoped to Setup only (docs/P4.9-A4-UI-CONTRACT.md's own locked
// tier boundary) - only the create wrapper is added here. get/continue/cancel
// wrappers are added in their own tiers (T2-T4), not pre-built now.
import type { CreateOptimizationExperimentRequest, OptimizationExperimentView } from "@/types/optimization";

const BASE = "/api/private/algo-test/optimization";

async function parseErrorMessage(res: Response): Promise<string> {
  try {
    const json = await res.json();
    return json?.error?.message ?? `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
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
