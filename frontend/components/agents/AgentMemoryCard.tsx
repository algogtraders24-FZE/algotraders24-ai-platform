// components/agents/AgentMemoryCard.tsx
// Shows an agent's temporary memory entries.

import type { MemoryEntry } from "@/types/agent";

export default function AgentMemoryCard({ memory, enabled }: { memory: MemoryEntry[]; enabled: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-ink-2 p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-text-2">Memory</p>
        <span className={`text-xs ${enabled ? "text-success" : "text-text-3"}`}>{enabled ? "Enabled" : "Disabled"}</span>
      </div>
      <div className="space-y-2">
        {memory.map((m) => (
          <div key={m.id} className="rounded-lg bg-ink px-3 py-2 text-xs">
            <span className="text-text-3">{m.key}: </span>
            <span className="text-text">{m.value}</span>
          </div>
        ))}
        {memory.length === 0 && <p className="text-xs text-text-3">No memory stored.</p>}
      </div>
    </div>
  );
}