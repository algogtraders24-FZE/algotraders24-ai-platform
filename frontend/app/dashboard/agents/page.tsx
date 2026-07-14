"use client";
// app/dashboard/agents/page.tsx
// Sprint 14E - Agents, tasks, memory and activity now load from PostgreSQL via
// AgentEngine.load(). Markup, components and styling unchanged; only the data
// source and the surrounding loading/error handling are new.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Agent } from "@/types/agent";
import {
  loadAgents,
  runAgent,
  pauseAgent,
  getAgent,
} from "@/services/agents/AgentManager";
import {
  getMetrics,
  getRecentActivity,
  load as loadAgentFramework,
} from "@/services/agents/AgentEngine";
import { getTasks } from "@/services/agents/AgentTaskManager";
import { getMemory } from "@/services/agents/AgentMemory";

import AgentMetrics from "@/components/agents/AgentMetrics";
import AgentGrid from "@/components/agents/AgentGrid";
import AgentDetails from "@/components/agents/AgentDetails";

export default function AgentsPage() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [agents, setAgents] = useState<Agent[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    setError(null);
    if (reloadKey > 0) setReady(false);

    loadAgentFramework({ signal: controller.signal, force: reloadKey > 0 })
      .then(() => {
        if (!active) return;
        const loaded = loadAgents();
        setAgents([...loaded]);
        setActiveId((current) => current ?? loaded[0]?.id ?? null);
        setReady(true);
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(
          err instanceof Error ? err.message : "Unable to load agents."
        );
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [reloadKey]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  const refresh = useCallback(() => setAgents([...loadAgents()]), []);

  const metrics = useMemo(
    () => (ready ? getMetrics() : null),
    [ready, agents]
  );

  const active = activeId ? getAgent(activeId) ?? null : null;

  const onRun = useCallback(
    (id: string) => {
      runAgent(id);
      refresh();
      setActiveId(id);
    },
    [refresh]
  );

  const onPause = useCallback(
    (id: string) => {
      pauseAgent(id);
      refresh();
    },
    [refresh]
  );

  const onOpen = useCallback((id: string) => setActiveId(id), []);

  const tasks = active ? getTasks(active.id) : [];
  const memory = active ? getMemory(active.id) : [];
  const activity = active ? getRecentActivity(active.id) : [];

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 p-6 text-slate-100">
        <div className="mx-auto max-w-6xl">
          <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-6 text-sm">
            <p className="font-semibold text-red-300">Could not load agents</p>
            <p className="mt-1 text-slate-400">{error}</p>
            <button
              onClick={retry}
              className="mt-4 rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-800"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!ready || !metrics) {
    return (
      <div className="min-h-screen bg-slate-950 p-6 text-slate-100">
        <div className="mx-auto max-w-6xl space-y-6">
          <header className="rounded-2xl border border-slate-800 bg-gradient-to-r from-indigo-600/20 to-purple-600/10 p-6">
            <h1 className="text-2xl font-bold">AI Agent Framework</h1>
            <p className="mt-1 text-sm text-slate-400">
              Central intelligence layer - autonomous agents
            </p>
          </header>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-24 animate-pulse rounded-xl border border-slate-800 bg-slate-900"
              />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="h-96 animate-pulse rounded-xl border border-slate-800 bg-slate-900 lg:col-span-2" />
            <div className="h-96 animate-pulse rounded-xl border border-slate-800 bg-slate-900" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="rounded-2xl border border-slate-800 bg-gradient-to-r from-indigo-600/20 to-purple-600/10 p-6">
          <h1 className="text-2xl font-bold">AI Agent Framework</h1>
          <p className="mt-1 text-sm text-slate-400">
            Central intelligence layer - autonomous agents
          </p>
        </header>

        <AgentMetrics metrics={metrics} />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <h2 className="mb-4 text-sm font-semibold text-slate-300">Agents</h2>
            <AgentGrid
              agents={agents}
              onOpen={onOpen}
              onRun={onRun}
              onPause={onPause}
            />
          </div>
          <div>
            <h2 className="mb-4 text-sm font-semibold text-slate-300">Details</h2>
            <AgentDetails
              agent={active}
              tasks={tasks}
              memory={memory}
              activity={activity}
            />
          </div>
        </div>
      </div>
    </div>
  );
}