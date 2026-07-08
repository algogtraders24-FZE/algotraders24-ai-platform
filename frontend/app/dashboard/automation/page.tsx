"use client";

import { useMemo, useState } from "react";
import type { Workflow, AutomationRun } from "@/types/automation";
import { getWorkflows, setWorkflowStatus, getWorkflowById } from "@/services/automation/WorkflowService";
import { runWorkflowNow, getMetrics } from "@/services/automation/AutomationEngine";
import { mockRuns, mockQueue } from "@/data/mock-automation";
import WorkflowList from "@/components/automation/WorkflowList";
import WorkflowEditor from "@/components/automation/WorkflowEditor";
import AutomationHistory from "@/components/automation/AutomationHistory";
import AutomationStatus from "@/components/automation/AutomationStatus";

export default function AutomationPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>(getWorkflows());
  const [runs, setRuns] = useState<AutomationRun[]>(mockRuns);
  const [activeId, setActiveId] = useState<string | null>(workflows[0]?.id ?? null);

  const metrics = useMemo(() => getMetrics(), [workflows, runs]);
  const active = activeId ? getWorkflowById(activeId) ?? null : null;

  const onRun = async (id: string) => {
    const run = await runWorkflowNow(id);
    if (run) setRuns((prev) => [run, ...prev]);
    setActiveId(id);
  };

  const onToggle = (id: string) => {
    const wf = getWorkflowById(id);
    if (!wf) return;
    setWorkflowStatus(id, wf.status === "active" ? "paused" : "active");
    setWorkflows([...getWorkflows()]);
  };

  const metricCards: [string, string | number][] = [
    ["Total Workflows", metrics.totalWorkflows],
    ["Active", metrics.activeWorkflows],
    ["Runs Today", metrics.runsToday],
    ["Success Rate", `${metrics.successRate}%`],
    ["Queued", metrics.queued],
  ];

  return (
    <div className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <div className="mx-auto max-w-6xl space-y-6">
        <header>
          <h1 className="text-2xl font-bold">AI Automation Engine</h1>
          <p className="text-xs text-slate-500">Workflows, scheduler, and queue - mock data</p>
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-5">
          {metricCards.map(([label, value]) => (
            <div key={label} className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
              <p className="text-xs text-slate-500">{label}</p>
              <p className="mt-1 text-2xl font-bold text-slate-100">{value}</p>
            </div>
          ))}
        </section>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <h2 className="text-sm font-semibold text-slate-300">Workflows</h2>
            <WorkflowList workflows={workflows} onRun={onRun} onToggle={onToggle} />
          </div>
          <div>
            <h2 className="mb-4 text-sm font-semibold text-slate-300">Details</h2>
            <WorkflowEditor workflow={active} />
          </div>
        </div>

        <section>
          <h2 className="mb-3 text-sm font-semibold text-slate-300">Queue</h2>
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            {mockQueue.length === 0 ? (
              <p className="text-xs text-slate-600">Queue is empty.</p>
            ) : (
              mockQueue.map((q) => (
                <div key={q.id} className="flex items-center justify-between py-1 text-sm">
                  <span className="text-slate-200">{q.workflowName}</span>
                  <AutomationStatus status={q.status} />
                </div>
              ))
            )}
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold text-slate-300">Execution History</h2>
          <AutomationHistory runs={runs} />
        </section>
      </div>
    </div>
  );
}
