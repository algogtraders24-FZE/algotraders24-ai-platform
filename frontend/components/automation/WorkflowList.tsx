// components/automation/WorkflowList.tsx
// Grid of workflow cards.

"use client";

import type { Workflow } from "@/types/automation";
import AutomationCard from "./AutomationCard";

interface Props {
  workflows: Workflow[];
  onRun: (id: string) => void;
  onToggle: (id: string) => void;
}

export default function WorkflowList({ workflows, onRun, onToggle }: Props) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {workflows.map((w) => (
        <AutomationCard key={w.id} workflow={w} onRun={onRun} onToggle={onToggle} />
      ))}
      {workflows.length === 0 && <p className="text-sm text-slate-500">No workflows yet.</p>}
    </div>
  );
}