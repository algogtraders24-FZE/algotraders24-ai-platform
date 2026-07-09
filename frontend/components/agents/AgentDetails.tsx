// components/agents/AgentDetails.tsx
// Full agent detail panel composed of sub-cards.

"use client";

import type { Agent, AgentTask, MemoryEntry, AgentActivity as Activity } from "@/types/agent";
import { resolveTools } from "@/services/agents/AgentTools";
import AgentStatus from "./AgentStatus";
import AgentTaskQueue from "./AgentTaskQueue";
import AgentMemoryCard from "./AgentMemoryCard";
import AgentActivity from "./AgentActivity";

interface Props {
  agent: Agent | null;
  tasks: AgentTask[];
  memory: MemoryEntry[];
  activity: Activity[];
}

export default function AgentDetails({ agent, tasks, memory, activity }: Props) {
  if (!agent) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 text-sm text-slate-500">
        Select an agent to view details.
      </div>
    );
  }

  const tools = resolveTools(agent.tools);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-900/40 p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 text-base font-bold text-white">
            {agent.avatar}
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-100">{agent.name}</h2>
              <AgentStatus status={agent.status} />
            </div>
            <p className="mt-1 text-xs text-slate-400">{agent.description}</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <div><p className="text-slate-500">Provider</p><p className="text-slate-200">{agent.provider}</p></div>
          <div><p className="text-slate-500">Version</p><p className="text-slate-200">{agent.version}</p></div>
          <div><p className="text-slate-500">Priority</p><p className="text-slate-200">P{agent.priority}</p></div>
          <div><p className="text-slate-500">Est. Cost</p><p className="text-slate-200">{agent.estimatedCost}</p></div>
        </div>

        <div className="mt-4">
          <p className="text-xs font-semibold text-slate-400">Goal</p>
          <p className="mt-1 text-sm text-slate-300">{agent.goal}</p>
        </div>

        <div className="mt-4">
          <p className="text-xs font-semibold text-slate-400">Capabilities</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {agent.capabilities.map((c) => (
              <span key={c} className="rounded-lg border border-slate-800 px-2.5 py-1 text-xs text-slate-300">{c}</span>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <p className="text-xs font-semibold text-slate-400">Tools</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {tools.map((t) => (
              <span key={t.id} className="rounded-lg bg-slate-800/60 px-2.5 py-1 text-xs text-slate-300">{t.name}</span>
            ))}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
          <div><p className="text-slate-500">Last Run</p><p className="text-slate-200">{agent.lastRun ? new Date(agent.lastRun).toLocaleString() : "—"}</p></div>
          <div><p className="text-slate-500">Next Run</p><p className="text-slate-200">{agent.nextRun ? new Date(agent.nextRun).toLocaleString() : "—"}</p></div>
        </div>
      </div>

      <AgentTaskQueue tasks={tasks} />
      <AgentMemoryCard memory={memory} enabled={agent.memoryEnabled} />
      <AgentActivity activity={activity} />
    </div>
  );
}