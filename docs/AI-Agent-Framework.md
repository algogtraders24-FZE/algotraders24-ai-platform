# AI Agent Framework

Central intelligence layer. Autonomous agents that plan, execute tasks, use tools, and keep memory. Mock/in-memory only — no DB, no external APIs.

## Architecture

Request -> AgentManager -> AgentPlanner -> AgentTaskManager (queue) -> AgentExecutor (tools) -> AgentMemory -> Result.

The dashboard talks only to AgentEngine (the facade), never to sub-services.

## Services

- AgentRegistry — registers every agent; lookup by id or type.
- AgentManager — loads agents and owns status transitions (run/pause/resume).
- AgentTools — tool registry; resolves an agent's tool ids to full tools.
- AgentMemory — temporary per-agent key/value memory (TTL foundation).
- AgentPlanner — breaks a goal/request into ordered tasks.
- AgentTaskManager — in-memory task queue with a concurrency limit.
- AgentExecutor — runs tasks, writes memory, returns activity.
- AgentEngine — orchestration facade: runAgentPipeline, getMetrics, getRecentActivity.
- AgentConversation — chat interface; wraps the existing assistant/Gemini so an agent answers in its role.

## Flow

1. User picks an agent and a request.
2. Manager loads the agent.
3. Planner turns the request into tasks (one per tool + a synthesis step).
4. Task Manager queues them.
5. Executor runs each task, updating memory.
6. Engine returns activity; the dashboard shows tasks, memory, and history.

## Agent Model

Each agent has id, type, name, description, avatar, status, provider, version, memoryEnabled, tools, capabilities, goal, priority, lastRun, nextRun, tasksCompleted, successRate, estimatedCost.

## Folder Structure

- services/agents — the nine services above.
- components/agents — AgentCard, AgentGrid, AgentDetails, AgentStatus, AgentTaskQueue, AgentMemoryCard, AgentActivity, AgentMetrics.
- types/agent.ts, config/agent.config.ts, data/mock-agents.ts, app/dashboard/agents/page.tsx.

## Future Expansion

- Real tool execution: each tool id maps to a real service call (trading, publishing, news).
- Persistent memory: AgentMemory swaps in a DB/vector store behind the same interface.
- Real queue: AgentTaskManager backed by Redis/BullMQ; executor becomes a worker.
- Multi-agent collaboration: agents call other agents via the engine.
- Provider choice per agent: already typed (agent.provider) — routes through the existing Provider Factory.

Because agents reference tools and providers by id, adding real capability needs only new implementations — the UI, types, and workflow stay unchanged.