// components/automation/AutomationCard.tsx
// A single workflow card with run/pause actions.

"use client";

import type { Workflow } from "@/types/automation";
import AutomationStatus from "./AutomationStatus";

interface Props {
  workflow: Workflow;
  onRun: (id: string) => void;
  onToggle: (id: string) => void;
}

export default function AutomationCard({ workflow, onRun, onToggle }: Props) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">{workflow.name}</h3>
          <p className="mt-1 text-xs text-slate-500">{workflow.description}</p>
        </div>
        <AutomationStatus status={workflow.status} />
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
        <span className="rounded bg-slate-800/60 px-2 py-0.5 capitalize">{workflow.trigger}</span>
        {workflow.schedule && <span className="rounded bg-slate-800/60 px-2 py-0.5">{workflow.schedule}</span>}
        <span className="rounded bg-slate-800/60 px-2 py-0.5">{workflow.steps.length} steps</span>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          onClick={() => onRun(workflow.id)}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500"
        >
          Run now
        </button>
        <button
          onClick={() => onToggle(workflow.id)}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-600"
        >
          {workflow.status === "active" ? "Pause" : "Activate"}
        </button>
      </div>
    </div>
  );
}