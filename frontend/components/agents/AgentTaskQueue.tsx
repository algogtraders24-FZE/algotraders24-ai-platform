// components/agents/AgentTaskQueue.tsx
// Task queue list for an agent.

import type { AgentTask } from "@/types/agent";

const STATUS_COLOR: Record<AgentTask["status"], string> = {
  queued: "text-slate-400",
  running: "text-indigo-400",
  done: "text-emerald-400",
  failed: "text-red-400",
};

export default function AgentTaskQueue({ tasks }: { tasks: AgentTask[] }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <p className="mb-3 text-sm font-semibold text-slate-300">Today's Tasks</p>
      <div className="space-y-2">
        {tasks.map((t) => (
          <div key={t.id} className="flex items-center justify-between text-xs">
            <span className="text-slate-300">{t.title}</span>
            <span className={`font-semibold capitalize ${STATUS_COLOR[t.status]}`}>{t.status}</span>
          </div>
        ))}
        {tasks.length === 0 && <p className="text-xs text-slate-600">No tasks.</p>}
      </div>
    </div>
  );
}