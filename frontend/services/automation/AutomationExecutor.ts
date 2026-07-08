// services/automation/AutomationExecutor.ts
// Executes the steps of a workflow and returns a run record.
// Mock only — each step is simulated, no real side effects.

import type { Workflow, AutomationRun } from "@/types/automation";
import { getAction } from "./AutomationRegistry";

export async function executeWorkflow(workflow: Workflow): Promise<AutomationRun> {
  const startedAt = new Date().toISOString();
  const log: string[] = [];
  let failed = false;

  for (const step of workflow.steps) {
    const action = getAction(step.actionId);
    if (!action) {
      log.push(`Unknown action: ${step.actionId}`);
      failed = true;
      break;
    }
    // Simulated execution.
    log.push(`Ran: ${action.name}`);
  }

  const finishedAt = new Date().toISOString();
  const durationMs = new Date(finishedAt).getTime() - new Date(startedAt).getTime();

  return {
    id: `run-${Date.now()}`,
    workflowId: workflow.id,
    workflowName: workflow.name,
    status: failed ? "failed" : "success",
    startedAt,
    finishedAt,
    durationMs,
    log,
  };
}