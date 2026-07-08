// components/automation/AutomationStatus.tsx
// Small status pill reused for workflow status and run status.

import type { WorkflowStatus, RunStatus } from "@/types/automation";

type AnyStatus = WorkflowStatus | RunStatus;

const MAP: Record<AnyStatus, string> = {
  active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  paused: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  draft: "bg-slate-500/15 text-slate-400 border-slate-500/30",
  queued: "bg-slate-500/15 text-slate-400 border-slate-500/30",
  running: "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
  success: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  failed: "bg-red-500/15 text-red-400 border-red-500/30",
};

export default function AutomationStatus({ status }: { status: AnyStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${MAP[status]}`}>
      {status}
    </span>
  );
}