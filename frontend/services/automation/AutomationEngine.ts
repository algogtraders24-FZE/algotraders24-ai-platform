// services/automation/AutomationEngine.ts
// Public facade for the automation system. UI talks to this, not to the
// individual services. Coordinates workflows, execution, queue, and metrics.

import type { Workflow, AutomationRun, AutomationMetrics } from "@/types/automation";
import { getWorkflows } from "./WorkflowService";
import { executeWorkflow } from "./AutomationExecutor";
import { enqueue, getQueue } from "./AutomationRunner";
import { mockRuns } from "@/data/mock-automation";

/** Run a workflow immediately (manual trigger). */
export async function runWorkflowNow(workflowId: string): Promise<AutomationRun | null> {
  const wf = getWorkflows().find((w) => w.id === workflowId);
  if (!wf) return null;
  return executeWorkflow(wf);
}

/** Queue a workflow for later execution. */
export function queueWorkflow(workflowId: string): void {
  const wf = getWorkflows().find((w) => w.id === workflowId);
  if (wf) enqueue(wf);
}

export function getMetrics(): AutomationMetrics {
  const workflows = getWorkflows();
  const active = workflows.filter((w) => w.status === "active").length;
  const success = mockRuns.filter((r) => r.status === "success").length;
  const successRate = mockRuns.length ? Math.round((success / mockRuns.length) * 100) : 0;

  return {
    totalWorkflows: workflows.length,
    activeWorkflows: active,
    runsToday: mockRuns.length,
    successRate,
    queued: getQueue().length,
  };
}