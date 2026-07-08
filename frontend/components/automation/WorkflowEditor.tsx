// components/automation/WorkflowEditor.tsx
// Workflow detail / editor foundation. Shows steps and schedule.
// Editing is stubbed for now (foundation only).

"use client";

import type { Workflow } from "@/types/automation";
import { SCHEDULE_PRESETS } from "@/config/automation.config";

export default function WorkflowEditor({ workflow }: { workflow: Workflow | null }) {
  if (!workflow) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 text-sm text-slate-500">
        Select a workflow to view its steps.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
      <h2 className="text-lg font-bold text-slate-100">{workflow.name}</h2>
      <p className="mt-1 text-xs text-slate-500">{workflow.description}</p>

      <div className="mt-4">
        <p className="text-xs font-semibold text-slate-400">Steps</p>
        <ol className="mt-2 space-y-2">
          {workflow.steps.map((s, i) => (
            <li key={s.id} className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-xs text-white">{i + 1}</span>
              <span className="text-slate-200">{s.label}</span>
              <span className="ml-auto text-xs text-slate-600">{s.actionId}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-4">
        <p className="text-xs font-semibold text-slate-400">Schedule Presets</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {SCHEDULE_PRESETS.map((p) => (
            <span
              key={p.value}
              className={`rounded-lg border px-2.5 py-1 text-xs ${
                workflow.schedule === p.value
                  ? "border-indigo-500/40 bg-indigo-500/15 text-indigo-300"
                  : "border-slate-800 text-slate-500"
              }`}
            >
              {p.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}