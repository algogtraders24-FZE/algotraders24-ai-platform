// components/agents/AgentMetrics.tsx
// Statistics cards row for the agents dashboard.

import type { AgentMetrics as Metrics } from "@/types/agent";

export default function AgentMetrics({ metrics }: { metrics: Metrics }) {
  const cards: [string, string | number][] = [
    ["Total Agents", metrics.totalAgents],
    ["Running", metrics.running],
    ["Idle", metrics.idle],
    ["Busy", metrics.busy],
    ["Success Rate", `${metrics.successRate}%`],
    ["Tasks Today", metrics.tasksToday],
  ];
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
      {cards.map(([label, value]) => (
        <div key={label} className="rounded-xl border border-border bg-ink-2 p-4">
          <p className="text-xs text-text-3">{label}</p>
          <p className="mt-1 text-2xl font-bold text-text">{value}</p>
        </div>
      ))}
    </div>
  );
}