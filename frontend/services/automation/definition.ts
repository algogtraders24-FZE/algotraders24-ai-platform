// services/automation/definition.ts
// AT24 Automation (MVP) - helpers to derive the denormalised trigger columns
// from a validated workflow definition, and to normalise a definition before
// it is stored (Beta forces the schedule timezone to IST).

import type {
  AutomationWorkflowDefinition,
  AutomationStep,
  AutomationTriggerType,
} from "@/types/automation";
import { AUTOMATION_SCHEDULE_TIMEZONE } from "@/config/automation-slots";
import type { TriggerDenorm } from "./automation-repository";

/** Beta rule: once/daily/weekly always run on IST; the stored timezone is the
 *  post-Beta upgrade seam. Manual keeps whatever was supplied (used only for
 *  display). */
export function normaliseDefinition(def: AutomationWorkflowDefinition): AutomationWorkflowDefinition {
  const scheduled = def.trigger.type !== "manual";
  return {
    ...def,
    trigger: {
      ...def.trigger,
      timezone: scheduled ? AUTOMATION_SCHEDULE_TIMEZONE : def.trigger.timezone,
    },
  };
}

export function triggerDenormFromDefinition(def: AutomationWorkflowDefinition): TriggerDenorm {
  const t = def.trigger;
  return {
    triggerType: t.type as AutomationTriggerType,
    slot: t.slot ?? null,
    daysOfWeek: t.type === "weekly" ? [...(t.daysOfWeek ?? [])] : [],
    runAt: t.type === "once" && t.runAt ? new Date(t.runAt) : null,
  };
}

/** A short human label for a step, for the Run Detail / builder review. */
export function stepLabel(step: AutomationStep): string {
  switch (step.kind) {
    case "agent_run":
      return `Run ${AGENT_LABELS[step.action.agentType] ?? step.action.agentType}`;
    case "condition":
      return `If ${step.condition.left} ${OP_LABELS[step.condition.op]} ${String(step.condition.right)}`;
    case "publication_draft":
      return "Create publication draft";
    case "workspace_save":
      return `Save "${step.action.title}" to Workspace`;
  }
}

const AGENT_LABELS: Record<string, string> = {
  RESEARCH: "AI Research",
  MARKET_INTELLIGENCE: "Market Intelligence",
  STRATEGY_RESEARCH: "Strategy Research",
};

const OP_LABELS: Record<string, string> = {
  gte: ">=",
  gt: ">",
  lte: "<=",
  lt: "<",
  eq: "==",
  neq: "!=",
};

export function isScheduledTrigger(type: AutomationTriggerType): boolean {
  return type === "once" || type === "daily" || type === "weekly";
}
