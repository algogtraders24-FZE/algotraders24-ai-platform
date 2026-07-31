// components/agents/AgentCard.tsx
// A single agent card with avatar, status, and quick actions.

"use client";

import type { Agent } from "@/types/agent";
import AgentStatus from "./AgentStatus";

interface Props {
  agent: Agent;
  onOpen: (id: string) => void;
  onRun: (id: string) => void;
  onPause: (id: string) => void;
}

export default function AgentCard({ agent, onOpen, onRun, onPause }: Props) {
  return (
    <div className="rounded-xl border border-border bg-ink-2 p-4 transition hover:border-border">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-gold to-gold text-sm font-bold text-text">
          {agent.avatar}
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text">{agent.name}</h3>
            <AgentStatus status={agent.status} />
          </div>
          <p className="mt-1 text-xs text-text-3 line-clamp-2">{agent.description}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs text-text-3">
        <span className="rounded bg-ink-3 px-2 py-0.5">{agent.tasksCompleted} tasks</span>
        <span className="rounded bg-ink-3 px-2 py-0.5">{agent.successRate}% success</span>
        <span className="rounded bg-ink-3 px-2 py-0.5">{agent.provider}</span>
      </div>

      <div className="mt-4 flex gap-2">
        <button onClick={() => onOpen(agent.id)} className="rounded-lg bg-gold px-3 py-1.5 text-xs font-semibold text-ink hover:brightness-110">Details</button>
        <button onClick={() => onRun(agent.id)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-2 hover:border-border">Run</button>
        <button onClick={() => onPause(agent.id)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-2 hover:border-border">Pause</button>
      </div>
    </div>
  );
}