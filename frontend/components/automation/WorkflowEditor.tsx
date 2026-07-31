// components/automation/WorkflowEditor.tsx
// Workflow detail / editor foundation. Shows steps and schedule.
// Editing is stubbed for now (foundation only).

"use client";

import type { Workflow } from "@/types/automation";
import { SCHEDULE_PRESETS } from "@/config/automation.config";

export default function WorkflowEditor({ workflow }: { workflow: Workflow | null }) {
  if (!workflow) {
    return (
      <div className="rounded-xl border border-border bg-ink-2 p-6 text-sm text-text-3">
        Select a workflow to view its steps.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-ink-2 p-5">
      <h2 className="text-lg font-bold text-text">{workflow.name}</h2>
      <p className="mt-1 text-xs text-text-3">{workflow.description}</p>

      <div className="mt-4">
        <p className="text-xs font-semibold text-text-2">Steps</p>
        <ol className="mt-2 space-y-2">
          {workflow.steps.map((s, i) => (
            <li key={s.id} className="flex items-center gap-3 rounded-lg border border-border bg-ink px-3 py-2 text-sm">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gold text-xs text-ink">{i + 1}</span>
              <span className="text-text">{s.label}</span>
              <span className="ml-auto text-xs text-text-3">{s.actionId}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-4">
        <p className="text-xs font-semibold text-text-2">Schedule Presets</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {SCHEDULE_PRESETS.map((p) => (
            <span
              key={p.value}
              className={`rounded-lg border px-2.5 py-1 text-xs ${
                workflow.schedule === p.value
                  ? "border-gold/40 bg-gold/15 text-gold"
                  : "border-border text-text-3"
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