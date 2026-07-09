"use client";

import { useMemo, useState } from "react";
import type { Agent } from "@/types/agent";
import { loadAgents, runAgent, pauseAgent, getAgent } from "@/services/agents/AgentManager";
import { getMetrics, getRecentActivity } from "@/services/agents/AgentEngine";
import { getTasks } from "@/services/agents/AgentTaskManager";
import { getMemory } from "@/services/agents/AgentMemory";
import AgentMetrics from "@/components/agents/AgentMetrics";
import AgentGrid from "@/components/agents/AgentGrid";
import AgentDetails from "@/components/agents/AgentDetails";

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>(loadAgents());
  const [activeId, setActiveId] = useState<string | null>(agents[0]?.id ?? null);

  const metrics = useMemo(() => getMetrics(), [agents]);
  const active = activeId ? getAgent(activeId) ?? null : null;

  const refresh = () => setAgents([...loadAgents()]);

  const onRun = (id: string) => { runAgent(id); refresh(); setActiveId(id); };
  const onPause = (id: string) => { pauseAgent(id); refresh(); };
  const onOpen = (id: string) => setActiveId(id);

  const tasks = active ? getTasks(active.id) : [];
  const memory = active ? getMemory(active.id) : [];
  const activity = active ? getRecentActivity(active.id) : [];

  return (
    <div className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="rounded-2xl border border-slate-800 bg-gradient-to-r from-indigo-600/20 to-purple-600/10 p-6">
          <h1 className="text-2xl font-bold">AI Agent Framework</h1>
          <p className="mt-1 text-sm text-slate-400">Central intelligence layer - autonomous agents (mock data)</p>
        </header>

        <AgentMetrics metrics={metrics} />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <h2 className="mb-4 text-sm font-semibold text-slate-300">Agents</h2>
            <AgentGrid agents={agents} onOpen={onOpen} onRun={onRun} onPause={onPause} />
          </div>
          <div>
            <h2 className="mb-4 text-sm font-semibold text-slate-300">Details</h2>
            <AgentDetails agent={active} tasks={tasks} memory={memory} activity={activity} />
          </div>
        </div>
      </div>
    </div>
  );
}
