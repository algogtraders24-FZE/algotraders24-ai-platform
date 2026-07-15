// services/api/workflowMetrics.ts
// Sprint 14E - Client-side derivations for the automation dashboard.
import type { Workflow, AutomationRun, QueueItem, AutomationMetrics } from "@/types/automation";

/** Attach workflowName to runs/queue coming from the DB (which omit it). */
export function enrichRuns(runs: AutomationRun[], workflows: Workflow[]): AutomationRun[] {
  const nameById = new Map(workflows.map((w) => [w.id, w.name]));
  return runs.map((r) => ({ ...r, workflowName: r.workflowName || nameById.get(r.workflowId) || "Unknown" }));
}

export function enrichQueue(queue: QueueItem[], workflows: Workflow[]): QueueItem[] {
  const nameById = new Map(workflows.map((w) => [w.id, w.name]));
  return queue.map((q) => ({ ...q, workflowName: q.workflowName || nameById.get(q.workflowId) || "Unknown" }));
}

export function computeMetrics(
  workflows: Workflow[],
  runs: AutomationRun[],
  queue: QueueItem[]
): AutomationMetrics {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const runsToday = runs.filter((r) => new Date(r.startedAt) >= startOfDay).length;
  const finished = runs.filter((r) => r.status === "success" || r.status === "failed");
  const succeeded = finished.filter((r) => r.status === "success").length;
  const successRate = finished.length === 0 ? 0 : Math.round((succeeded / finished.length) * 100);
  return {
    totalWorkflows: workflows.length,
    activeWorkflows: workflows.filter((w) => w.status === "active").length,
    runsToday,
    successRate,
    queued: queue.length,
  };
}
