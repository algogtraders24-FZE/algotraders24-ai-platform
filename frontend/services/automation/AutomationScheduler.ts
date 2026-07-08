// services/automation/AutomationScheduler.ts
// Scheduler foundation. Reads scheduled workflows and reports which are "due".
// Real cron/worker integration comes later; this defines the contract.

import type { Workflow } from "@/types/automation";
import { getWorkflows } from "./WorkflowService";

export function getScheduledWorkflows(): Workflow[] {
  return getWorkflows().filter((w) => w.trigger === "scheduled" && w.status === "active");
}

/** Placeholder due-check. A real scheduler would parse the cron against now. */
export function getDueWorkflows(): Workflow[] {
  // For the foundation, treat all active scheduled workflows as candidates.
  return getScheduledWorkflows();
}