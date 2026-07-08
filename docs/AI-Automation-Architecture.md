# AI Automation Engine

Enterprise workflow automation foundation. Mock/in-memory only — no DB, no external APIs.

## Architecture

UI -> AutomationEngine (facade) -> WorkflowService / Executor / Runner / Scheduler / Registry.

The dashboard talks only to AutomationEngine, never to individual services.

## Modules

- AutomationRegistry — catalog of runnable actions (analyze-market, generate-article, publish-article, summarize-news, send-newsletter). Workflows reference actions by id.
- WorkflowService — repository-style access to workflows (get, status toggle). Swap mock for DB later without changing callers.
- AutomationExecutor — runs a workflow's steps and returns an AutomationRun with a log. Steps are simulated.
- AutomationScheduler — foundation that reports which scheduled workflows are due. Real cron parsing comes later.
- AutomationRunner — task-queue foundation: enqueue, getQueue, drainQueue with max concurrency from config.
- AutomationEngine — public facade: runWorkflowNow, queueWorkflow, getMetrics.

## Workflow Model

A Workflow has a trigger (manual/scheduled/event), an optional schedule, a status (active/paused/draft), and ordered steps. Each step maps to a registry actionId.

## Execution History

Every run produces an AutomationRun (status, start/finish, duration, log). The dashboard lists these in the history table.

## Queue Monitoring

The runner holds queued items with a max size and concurrency limit (config). The dashboard shows the current queue.

## Future Scheduler

A cron job or background worker calls scheduler.getDueWorkflows() on an interval and enqueues them via the runner.

## Future Integrations

Actions currently simulate work. Real implementations call existing services (trading copilot, publishing) or external channels. Because workflows reference actions by id, adding a real action needs only a registry entry plus its executor logic — no UI or workflow-model change.

## Repository Pattern

WorkflowService and the mock data source are separated from consumers. Replacing the in-memory store with a database (or queue system like Redis/BullMQ) changes only these services.