// types/automation.ts
// AI Automation Engine — core types

export type WorkflowTrigger = "manual" | "scheduled" | "event";

export type WorkflowStatus = "active" | "paused" | "draft";

export type RunStatus = "queued" | "running" | "success" | "failed";

/** A single step inside a workflow (maps to an action id from the registry). */
export interface WorkflowStep {
  id: string;
  actionId: string;
  label: string;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  trigger: WorkflowTrigger;
  schedule: string | null; // cron-like or human string, null for manual
  status: WorkflowStatus;
  steps: WorkflowStep[];
  createdAt: string;
  updatedAt: string;
}

/** A registered automation action the executor can run. */
export interface AutomationAction {
  actionId: string;
  name: string;
  description: string;
}

/** One execution record of a workflow. */
export interface AutomationRun {
  id: string;
  workflowId: string;
  workflowName: string;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  log: string[];
}

/** Queue item awaiting execution. */
export interface QueueItem {
  id: string;
  workflowId: string;
  workflowName: string;
  enqueuedAt: string;
  status: RunStatus;
}

export interface AutomationMetrics {
  totalWorkflows: number;
  activeWorkflows: number;
  runsToday: number;
  successRate: number; // 0–100
  queued: number;
}