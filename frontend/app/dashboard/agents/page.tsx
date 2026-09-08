// app/dashboard/agents/page.tsx
// The "AI Agents" destination IS now the real A1-A15 Agent Framework run
// console. This route redirects there. The older agent-builder scaffold
// (services/agents/*, components/agents/AgentGrid|AgentDetails|AgentMetrics,
// the mock AgentEngine/AgentManager) stays in the tree but is no longer
// routed - it was never wired to the real runtime (AN1.2 decision D3 kept
// it as a frozen legacy layer through A15; A15's console superseded it).
import { redirect } from "next/navigation";

export default function AgentsPage() {
  redirect("/dashboard/agents/runs");
}
