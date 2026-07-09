// components/agents/AgentStatus.tsx
// Animated status badge for agents.

import type { AgentStatus as Status } from "@/types/agent";
import { STATUS_STYLES } from "@/config/agent.config";

export default function AgentStatus({ status }: { status: Status }) {
  const pulse = status === "running" || status === "busy";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${STATUS_STYLES[status]}`}>
      <span className={`h-1.5 w-1.5 rounded-full bg-current ${pulse ? "animate-pulse" : ""}`} />
      {status}
    </span>
  );
}