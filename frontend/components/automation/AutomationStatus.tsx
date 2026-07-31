// components/automation/AutomationStatus.tsx
// Small status pill reused for workflow status and run status.

import type { WorkflowStatus, RunStatus } from "@/types/automation";

type AnyStatus = WorkflowStatus | RunStatus;

const MAP: Record<AnyStatus, string> = {
  active: "bg-success/15 text-success border-success/30",
  paused: "bg-warning/15 text-warning border-warning/30",
  draft: "bg-ink-4 text-text-2 border-border",
  queued: "bg-ink-4 text-text-2 border-border",
  running: "bg-gold/15 text-gold border-gold/30",
  success: "bg-success/15 text-success border-success/30",
  failed: "bg-danger/15 text-danger border-danger/30",
};

export default function AutomationStatus({ status }: { status: AnyStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${MAP[status]}`}>
      {status}
    </span>
  );
}