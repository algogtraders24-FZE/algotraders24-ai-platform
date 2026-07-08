// services/automation/AutomationRunner.ts
// Task-queue foundation. Holds queued items and drains them through the
// executor, respecting a max-concurrency limit. Mock/in-memory only.

import type { Workflow, AutomationRun, QueueItem } from "@/types/automation";
import { AUTOMATION_CONFIG } from "@/config/automation.config";
import { executeWorkflow } from "./AutomationExecutor";

const queue: QueueItem[] = [];

export function enqueue(workflow: Workflow): QueueItem {
  const item: QueueItem = {
    id: `q-${Date.now()}`,
    workflowId: workflow.id,
    workflowName: workflow.name,
    enqueuedAt: new Date().toISOString(),
    status: "queued",
  };
  if (queue.length < AUTOMATION_CONFIG.maxQueueSize) queue.push(item);
  return item;
}

export function getQueue(): QueueItem[] {
  return queue;
}

/** Drain up to maxConcurrentRuns items, executing each. */
export async function drainQueue(workflows: Workflow[]): Promise<AutomationRun[]> {
  const batch = queue.splice(0, AUTOMATION_CONFIG.maxConcurrentRuns);
  const runs: AutomationRun[] = [];
  for (const item of batch) {
    const wf = workflows.find((w) => w.id === item.workflowId);
    if (wf) runs.push(await executeWorkflow(wf));
  }
  return runs;
}