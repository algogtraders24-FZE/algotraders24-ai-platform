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
      <div className="rounded-xl border border-border bg-ink-2 p-6 text-sm text-text-3">
        Select an agent to view details.
      </div>
    );
  }

  const tools = resolveTools(agent.tools);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-gradient-to-br from-ink-2 to-ink-2 p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br from-gold to-gold text-base font-bold text-text">
            {agent.avatar}
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-text">{agent.name}</h2>
              <AgentStatus status={agent.status} />
            </div>
            <p className="mt-1 text-xs text-text-2">{agent.description}</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <div><p className="text-text-3">Provider</p><p className="text-text">{agent.provider}</p></div>
          <div><p className="text-text-3">Version</p><p className="text-text">{agent.version}</p></div>
          <div><p className="text-text-3">Priority</p><p className="text-text">P{agent.priority}</p></div>
          <div><p className="text-text-3">Est. Cost</p><p className="text-text">{agent.estimatedCost}</p></div>
        </div>

        <div className="mt-4">
          <p className="text-xs font-semibold text-text-2">Goal</p>
          <p className="mt-1 text-sm text-text-2">{agent.goal}</p>
        </div>

        <div className="mt-4">
          <p className="text-xs font-semibold text-text-2">Capabilities</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {agent.capabilities.map((c) => (
              <span key={c} className="rounded-lg border border-border px-2.5 py-1 text-xs text-text-2">{c}</span>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <p className="text-xs font-semibold text-text-2">Tools</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {tools.map((t) => (
              <span key={t.id} className="rounded-lg bg-ink-3 px-2.5 py-1 text-xs text-text-2">{t.name}</span>
            ))}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
          <div><p className="text-text-3">Last Run</p><p className="text-text">{agent.lastRun ? new Date(agent.lastRun).toLocaleString() : "—"}</p></div>
          <div><p className="text-text-3">Next Run</p><p className="text-text">{agent.nextRun ? new Date(agent.nextRun).toLocaleString() : "—"}</p></div>
        </div>
      </div>

      <AgentTaskQueue tasks={tasks} />
      <AgentMemoryCard memory={memory} enabled={agent.memoryEnabled} />
      <AgentActivity activity={activity} />
    </div>
  );
}