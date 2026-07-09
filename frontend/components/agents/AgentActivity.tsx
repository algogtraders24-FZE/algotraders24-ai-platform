// components/agents/AgentActivity.tsx
// Recent activity feed for an agent.

import type { AgentActivity as Activity } from "@/types/agent";

export default function AgentActivity({ activity }: { activity: Activity[] }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <p className="mb-3 text-sm font-semibold text-slate-300">Recent Activity</p>
      <div className="space-y-3">
        {activity.map((a) => (
          <div key={a.id} className="flex gap-3">
            <div className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />
            <div>
              <p className="text-xs text-slate-300">{a.message}</p>
              <p className="text-[10px] text-slate-600">{new Date(a.timestamp).toLocaleString()}</p>
            </div>
          </div>
        ))}
        {activity.length === 0 && <p className="text-xs text-slate-600">No recent activity.</p>}
      </div>
    </div>
  );
}