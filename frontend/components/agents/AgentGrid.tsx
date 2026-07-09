// components/agents/AgentGrid.tsx
// Responsive grid of agent cards.

"use client";

import type { Agent } from "@/types/agent";
import AgentCard from "./AgentCard";

interface Props {
  agents: Agent[];
  onOpen: (id: string) => void;
  onRun: (id: string) => void;
  onPause: (id: string) => void;
}

export default function AgentGrid({ agents, onOpen, onRun, onPause }: Props) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {agents.map((a) => (
        <AgentCard key={a.id} agent={a} onOpen={onOpen} onRun={onRun} onPause={onPause} />
      ))}
    </div>
  );
}