// types/automation.ts
// AT24 Automation (MVP) - shared contracts.
//
// LOCKED: AUTOMATION_DECISION_LOCK.md (owner 2026-09-10). Automation is the
// orchestration layer over the Agent Framework - Automation ->
// AutomationRun -> AgentRun. This file defines the versioned workflow
// definition, the API shapes, and the runtime enums. It mirrors the Prisma
// enums (prisma/schema.prisma) 1:1.

// ── Status / trigger / step enums (mirror Prisma) ─────────────────────────

export const AUTOMATION_STATUSES = ["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"] as const;
export type AutomationStatus = (typeof AUTOMATION_STATUSES)[number];

export const AUTOMATION_TRIGGER_TYPES = ["manual", "once", "daily", "weekly"] as const;
export type AutomationTriggerType = (typeof AUTOMATION_TRIGGER_TYPES)[number];

export const AUTOMATION_RUN_STATUSES = [
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CONDITION_HALTED",
  "CANCELLED",
  "CREDIT_BLOCKED",
] as const;
export type AutomationRunStatus = (typeof AUTOMATION_RUN_STATUSES)[number];

export const AUTOMATION_RUN_TRIGGERS = ["manual", "schedule"] as const;
export type AutomationRunTrigger = (typeof AUTOMATION_RUN_TRIGGERS)[number];

export const AUTOMATION_STEP_KINDS = [
  "agent_run",
  "condition",
  "publication_draft",
  "workspace_save",
] as const;
export type AutomationStepKind = (typeof AUTOMATION_STEP_KINDS)[number];

export const AUTOMATION_STEP_RUN_STATUSES = [
  "PENDING",
  "RUNNING",
  "OK",
  "FAILED",
  "SKIPPED",
] as const;
export type AutomationStepRunStatus = (typeof AUTOMATION_STEP_RUN_STATUSES)[number];

/** The 3 agent types Automation can execute in Beta - the framework's
 *  RUNNABLE_AGENT_TYPES (services/agent-framework/api/agent-run-service). */
export const AUTOMATION_AGENT_TYPES = ["RESEARCH", "MARKET_INTELLIGENCE", "STRATEGY_RESEARCH"] as const;
export type AutomationAgentType = (typeof AUTOMATION_AGENT_TYPES)[number];

export const AUTOMATION_CONDITION_OPS = ["gte", "gt", "lte", "lt", "eq", "neq"] as const;
export type AutomationConditionOp = (typeof AUTOMATION_CONDITION_OPS)[number];

export const AUTOMATION_WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
export type AutomationWeekday = (typeof AUTOMATION_WEEKDAYS)[number];

// ── Terminal-state helpers ───────────────────────────────────────────────

const TERMINAL_RUN_STATUSES: ReadonlySet<AutomationRunStatus> = new Set([
  "SUCCEEDED",
  "FAILED",
  "CONDITION_HALTED",
  "CANCELLED",
  "CREDIT_BLOCKED",
]);

export function isTerminalAutomationRunStatus(s: AutomationRunStatus): boolean {
  return TERMINAL_RUN_STATUSES.has(s);
}

// ── Versioned workflow definition (the `definition` JSON) ─────────────────

/** A restricted JSONPath into the run context: `$.steps.<id>.<field>` or
 *  `$.trigger.<field>`. No wildcards/filters/functions. */
export type AutomationJsonPath = string;

export interface AutomationTriggerConfig {
  type: AutomationTriggerType;
  /** IANA zone. Beta: forced "Asia/Kolkata" for once/daily/weekly. */
  timezone: string;
  /** Slot id from config/automation-slots.ts. Required for once/daily/weekly. */
  slot?: string;
  /** weekly only - non-empty subset of AUTOMATION_WEEKDAYS (IST calendar). */
  daysOfWeek?: AutomationWeekday[];
  /** once only - ISO date; the slot on/after this date fires the run. */
  runAt?: string;
}

export interface AutomationAgentRunStep {
  id: string;
  kind: "agent_run";
  action: {
    agentType: AutomationAgentType;
    /** The agent's goal object; the agent validates its own shape at run time. */
    input: Record<string, unknown>;
  };
  /** Optional: JSONPath (into this step's raw output) -> context key. */
  outputBindings?: Record<string, AutomationJsonPath>;
}

export interface AutomationConditionStep {
  id: string;
  kind: "condition";
  condition: {
    left: AutomationJsonPath;
    op: AutomationConditionOp;
    right: string | number | boolean;
  };
}

export interface AutomationPublicationDraftStep {
  id: string;
  kind: "publication_draft";
  action: {
    /** Must be a CONTENT_CATEGORIES value. */
    category: string;
    keywords?: string[];
    keywordsFrom?: AutomationJsonPath;
    aiOverviewFrom?: AutomationJsonPath;
  };
}

export interface AutomationWorkspaceSaveStep {
  id: string;
  kind: "workspace_save";
  action: {
    title: string;
    from: AutomationJsonPath;
  };
}

export type AutomationStep =
  | AutomationAgentRunStep
  | AutomationConditionStep
  | AutomationPublicationDraftStep
  | AutomationWorkspaceSaveStep;

export interface AutomationWorkflowDefinition {
  schemaVersion: 1;
  trigger: AutomationTriggerConfig;
  steps: AutomationStep[];
  metadata?: { templateId?: string; [k: string]: unknown };
}

// ── API shapes ───────────────────────────────────────────────────────────

export interface AutomationStats {
  runs: number;
  succeeded: number;
  failed: number;
  creditsUsed: number;
}

export interface AutomationOutputRef {
  kind: "agent_run" | "publication_draft" | "workspace_save" | "none";
  ids: Record<string, string>;
}

export interface AutomationRunSummary {
  id: string;
  status: AutomationRunStatus;
  trigger: AutomationRunTrigger;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  creditsUsed: number;
  stepCount: number;
  outputRef: AutomationOutputRef | null;
}

export interface AutomationListItem {
  id: string;
  name: string;
  description: string;
  status: AutomationStatus;
  timezone: string;
  trigger: {
    type: AutomationTriggerType;
    slot: string | null;
    daysOfWeek: AutomationWeekday[];
    runAt: string | null;
  };
  activeVersion: number | null;
  lastRun: AutomationRunSummary | null;
  nextRunAt: string | null;
  stats30d: AutomationStats;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationDetail extends AutomationListItem {
  definition: AutomationWorkflowDefinition;
  recentRuns: AutomationRunSummary[];
  owner: string;
}

export interface AutomationStepRunView {
  index: number;
  stepId: string;
  kind: AutomationStepKind;
  status: AutomationStepRunStatus;
  label: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  creditsUsed: number;
  agentRunId: string | null;
  articleId: string | null;
  artifactId: string | null;
  output: unknown;
  error: { code: string; message: string } | null;
  reason: string | null;
}

export interface AutomationRunDetail {
  id: string;
  automationId: string;
  automationName: string;
  definitionVersion: number;
  status: AutomationRunStatus;
  trigger: AutomationRunTrigger;
  scheduledFor: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  creditsUsed: number;
  steps: AutomationStepRunView[];
  error: { code: string; message: string; failedStepId?: string } | null;
  contextSnapshot: unknown;
}

// ── Validation issue shape ───────────────────────────────────────────────

export interface AutomationValidationIssue {
  path: string;
  message: string;
}

export interface AutomationValidationResult {
  ok: boolean;
  issues: AutomationValidationIssue[];
}
