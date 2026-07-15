"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Workflow, AutomationRun, QueueItem, WorkflowStatus } from "@/types/automation";
import { WorkflowsApi } from "@/services/api/WorkflowsApi";
import { enrichRuns, enrichQueue, computeMetrics } from "@/services/api/workflowMetrics";
import WorkflowList from "@/components/automation/WorkflowList";
import WorkflowEditor from "@/components/automation/WorkflowEditor";
import AutomationHistory from "@/components/automation/AutomationHistory";
import AutomationStatus from "@/components/automation/AutomationStatus";

export default function AutomationPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);

    WorkflowsApi.load({ signal: controller.signal })
      .then((data) => {
        const wfs = data.workflows ?? [];
        setWorkflows(wfs);
        setRuns(enrichRuns(data.runs ?? [], wfs));
        setQueue(enrichQueue(data.queue ?? [], wfs));
        setActiveId((prev) => prev ?? wfs[0]?.id ?? null);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Failed to load automations");
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, []);

  const metrics = useMemo(
    () => computeMetrics(workflows, runs, queue),
    [workflows, runs, queue]
  );
  const active = activeId ? workflows.find((w) => w.id === activeId) ?? null : null;

  const onRun = (id: string) => {
    const wf = workflows.find((w) => w.id === id);
    if (!wf) return;
    const now = new Date().toISOString();
    const optimistic: AutomationRun = {
      id: `run-local-${Date.now()}`,
      workflowId: id,
      workflowName: wf.name,
      status: "success",
      startedAt: now,
      finishedAt: now,
      durationMs: 0,
      log: ["Triggered manually"],
    };
    setRuns((prev) => [optimistic, ...prev]);
    setActiveId(id);
  };

  const onToggle = (id: string) => {
    setWorkflows((prev) =>
      prev.map((w) => {
        if (w.id !== id) return w;
        const next: WorkflowStatus = w.status === "active" ? "paused" : "active";
        return { ...w, status: next };
      })
    );
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
          <p className="text-xs text-slate-500">Workflows, scheduler, and queue</p>
        </header>

        {loading ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">
            Loading automations...
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-900/50 bg-red-950/30 p-8 text-center text-sm text-red-400">
            {error}
          </div>
        ) : (
          <>
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
                {queue.length === 0 ? (
                  <p className="text-xs text-slate-600">Queue is empty.</p>
                ) : (
                  queue.map((q) => (
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
          </>
        )}
      </div>
    </div>
  );
}
