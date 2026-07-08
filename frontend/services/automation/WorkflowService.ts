// services/automation/WorkflowService.ts
// Repository-style access to workflows. Swap the mock source for a DB later
// without changing callers.

import type { Workflow } from "@/types/automation";
import { mockWorkflows } from "@/data/mock-automation";

let workflows: Workflow[] = [...mockWorkflows];

export function getWorkflows(): Workflow[] {
  return workflows;
}

export function getWorkflowById(id: string): Workflow | undefined {
  return workflows.find((w) => w.id === id);
}

export function setWorkflowStatus(id: string, status: Workflow["status"]): Workflow | undefined {
  workflows = workflows.map((w) => (w.id === id ? { ...w, status, updatedAt: new Date().toISOString() } : w));
  return getWorkflowById(id);
}