// components/automation/ui.tsx
// AT24 Automation (MVP) - shared presentational bits. Pure view - every
// value shown here comes straight from a server response.
//
// Sprint UI-02.3 - AutomationStatusPill/RunStatusPill were hand-rolling
// their own pill markup (a rounded-md/border/bg/text recipe that
// duplicated Badge's own tone system). Both now render through the
// shared Badge primitive - same exported names/props, so no caller
// changes - just tone lookup instead of a hand-copied class string.
import Badge, { type BadgeTone } from "@/components/ui/Badge";
import type {
  AutomationListItem,
  AutomationRunStatus,
  AutomationStatus,
  AutomationStepKind,
  AutomationWorkflowDefinition,
} from "@/types/automation";

const STATUS_TONE: Record<AutomationStatus, BadgeTone> = {
  DRAFT: "neutral",
  ACTIVE: "success",
  PAUSED: "warning",
  ARCHIVED: "neutral",
};

// Beta content pass - both pills rendered the raw UPPERCASE enum value
// directly (e.g. "CREDIT_BLOCKED"). Same STEP_KIND_LABEL convention this
// file already established below, applied to status too.
const STATUS_LABEL: Record<AutomationStatus, string> = {
  DRAFT: "Draft",
  ACTIVE: "Active",
  PAUSED: "Paused",
  ARCHIVED: "Archived",
};

export function AutomationStatusPill({ status }: { status: AutomationStatus }) {
  return <Badge tone={STATUS_TONE[status] ?? STATUS_TONE.DRAFT}>{STATUS_LABEL[status] ?? status}</Badge>;
}

const RUN_TONE: Record<AutomationRunStatus, BadgeTone> = {
  QUEUED: "neutral",
  RUNNING: "gold",
  SUCCEEDED: "success",
  FAILED: "danger",
  CREDIT_BLOCKED: "danger",
  CONDITION_HALTED: "warning",
  CANCELLED: "neutral",
};

const RUN_STATUS_LABEL: Record<AutomationRunStatus, string> = {
  QUEUED: "Queued",
  RUNNING: "Running",
  SUCCEEDED: "Succeeded",
  FAILED: "Failed",
  CREDIT_BLOCKED: "Credit blocked",
  CONDITION_HALTED: "Condition halted",
  CANCELLED: "Cancelled",
};

export function RunStatusPill({ status }: { status: AutomationRunStatus }) {
  return <Badge tone={RUN_TONE[status] ?? RUN_TONE.QUEUED}>{RUN_STATUS_LABEL[status] ?? status.replace(/_/g, " ")}</Badge>;
}

export function describeTrigger(a: Pick<AutomationListItem, "trigger">): string {
  const t = a.trigger;
  if (t.type === "manual") return "Manual only";
  if (t.type === "once") return `Once${t.runAt ? ` — on/after ${new Date(t.runAt).toLocaleDateString()}` : ""} (${slotLabel(t.slot)} IST)`;
  if (t.type === "daily") return `Daily at ${slotLabel(t.slot)} IST`;
  return `${t.daysOfWeek.join(", ")} at ${slotLabel(t.slot)} IST`;
}

function slotLabel(slot: string | null): string {
  if (slot === "morning_ist") return "08:00";
  if (slot === "evening_ist") return "18:30";
  return slot ?? "—";
}

const STEP_KIND_LABEL: Record<AutomationStepKind, string> = {
  agent_run: "Run agent",
  condition: "Condition",
  publication_draft: "Publication draft",
  workspace_save: "Save to Workspace",
};

/** The vertical Trigger -> Action -> Condition -> Output sequence (sprint §15). */
export function WorkflowSequence({ def }: { def: AutomationWorkflowDefinition }) {
  return (
    <ol className="space-y-2">
      <li className="rounded-control border border-gold/30 bg-gold/5 px-3 py-2 text-sm">
        <span className="text-xs uppercase tracking-wide text-text-3">Trigger</span>
        <div className="text-text">{describeTrigger({ trigger: {
          type: def.trigger.type,
          slot: def.trigger.slot ?? null,
          daysOfWeek: def.trigger.daysOfWeek ?? [],
          runAt: def.trigger.runAt ?? null,
        } })}</div>
      </li>
      {def.steps.map((s) => (
        <li key={s.id} className="rounded-control border border-border bg-ink-3 px-3 py-2 text-sm">
          <span className="text-xs uppercase tracking-wide text-text-3">{STEP_KIND_LABEL[s.kind]}</span>
          <div className="text-text">{stepSummary(s)}</div>
        </li>
      ))}
    </ol>
  );
}

function stepSummary(s: AutomationWorkflowDefinition["steps"][number]): string {
  switch (s.kind) {
    case "agent_run":
      return `${s.action.agentType}${typeof s.action.input.symbol === "string" ? ` — ${s.action.input.symbol}` : ""}`;
    case "condition":
      return `${s.condition.left} ${s.condition.op} ${String(s.condition.right)}`;
    case "publication_draft":
      return `Category: ${s.action.category}`;
    case "workspace_save":
      return s.action.title;
  }
}
