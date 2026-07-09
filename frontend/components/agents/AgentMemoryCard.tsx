// components/agents/AgentMemoryCard.tsx
// Shows an agent's temporary memory entries.

import type { MemoryEntry } from "@/types/agent";

export default function AgentMemoryCard({ memory, enabled }: { memory: MemoryEntry[]; enabled: boolean }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-300">Memory</p>
        <span className={`text-xs ${enabled ? "text-emerald-400" : "text-slate-500"}`}>{enabled ? "Enabled" : "Disabled"}</span>
      </div>
      <div className="space-y-2">
        {memory.map((m) => (
          <div key={m.id} className="rounded-lg bg-slate-950/40 px-3 py-2 text-xs">
            <span className="text-slate-500">{m.key}: </span>
            <span className="text-slate-200">{m.value}</span>
          </div>
        ))}
        {memory.length === 0 && <p className="text-xs text-slate-600">No memory stored.</p>}
      </div>
    </div>
  );
}