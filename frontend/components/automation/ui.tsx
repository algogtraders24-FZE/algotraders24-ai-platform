// components/automation/ui.tsx
// AT24 Automation (MVP) - shared presentational bits. Pure view - every
// value shown here comes straight from a server response.
import type {
  AutomationListItem,
  AutomationRunStatus,
  AutomationStatus,
  AutomationStepKind,
  AutomationWorkflowDefinition,
} from "@/types/automation";

const STATUS_TONE: Record<AutomationStatus, string> = {
  DRAFT: "border-border bg-ink-3 text-text-2",
  ACTIVE: "border-success/40 bg-success/10 text-success",
  PAUSED: "border-warn/40 bg-warn/10 text-warn",
  ARCHIVED: "border-border bg-ink-3 text-text-3",
};

export function AutomationStatusPill({ status }: { status: AutomationStatus }) {
  return (
    <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${STATUS_TONE[status] ?? STATUS_TONE.DRAFT}`}>
      {status}
    </span>
  );
}

const RUN_TONE: Record<AutomationRunStatus, string> = {
  QUEUED: "border-border bg-ink-3 text-text-2",
  RUNNING: "border-gold/40 bg-gold/10 text-gold",
  SUCCEEDED: "border-success/40 bg-success/10 text-success",
  FAILED: "border-danger/40 bg-danger/10 text-danger",
  CREDIT_BLOCKED: "border-danger/40 bg-danger/10 text-danger",
  CONDITION_HALTED: "border-warn/40 bg-warn/10 text-warn",
  CANCELLED: "border-border bg-ink-3 text-text-3",
};

export function RunStatusPill({ status }: { status: AutomationRunStatus }) {
  return (
    <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${RUN_TONE[status] ?? RUN_TONE.QUEUED}`}>
      {status.replace("_", " ")}
    </span>
  );
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
      <li className="rounded-lg border border-gold/30 bg-gold/5 px-3 py-2 text-sm">
        <span className="text-xs uppercase tracking-wide text-text-3">Trigger</span>
        <div className="text-text">{describeTrigger({ trigger: {
          type: def.trigger.type,
          slot: def.trigger.slot ?? null,
          daysOfWeek: def.trigger.daysOfWeek ?? [],
          runAt: def.trigger.runAt ?? null,
        } })}</div>
      </li>
      {def.steps.map((s) => (
        <li key={s.id} className="rounded-lg border border-border bg-ink-3 px-3 py-2 text-sm">
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
