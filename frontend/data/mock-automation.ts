// data/mock-automation.ts
import type { Workflow, AutomationRun, QueueItem } from "@/types/automation";

export const mockWorkflows: Workflow[] = [
  {
    id: "wf-001",
    name: "Daily Gold Analysis",
    description: "Generate and publish gold analysis every morning.",
    trigger: "scheduled",
    schedule: "0 7 * * *",
    status: "active",
    steps: [
      { id: "s1", actionId: "analyze-market", label: "Analyze XAUUSD" },
      { id: "s2", actionId: "generate-article", label: "Generate article" },
      { id: "s3", actionId: "publish-article", label: "Publish to blog" },
    ],
    createdAt: "2025-01-10T06:00:00Z",
    updatedAt: "2025-01-15T06:00:00Z",
  },
  {
    id: "wf-002",
    name: "News Digest",
    description: "Summarize market news and send a newsletter.",
    trigger: "scheduled",
    schedule: "0 9 * * 1-5",
    status: "active",
    steps: [
      { id: "s1", actionId: "summarize-news", label: "Summarize news" },
      { id: "s2", actionId: "send-newsletter", label: "Send newsletter" },
    ],
    createdAt: "2025-01-11T06:00:00Z",
    updatedAt: "2025-01-14T06:00:00Z",
  },
  {
    id: "wf-003",
    name: "Weekly Review",
    description: "Compile a weekly market review article.",
    trigger: "scheduled",
    schedule: "0 18 * * 0",
    status: "paused",
    steps: [
      { id: "s1", actionId: "generate-article", label: "Generate review" },
    ],
    createdAt: "2025-01-05T06:00:00Z",
    updatedAt: "2025-01-12T06:00:00Z",
  },
];

export const mockRuns: AutomationRun[] = [
  {
    id: "run-001",
    workflowId: "wf-001",
    workflowName: "Daily Gold Analysis",
    status: "success",
    startedAt: "2025-01-15T07:00:00Z",
    finishedAt: "2025-01-15T07:00:12Z",
    durationMs: 12000,
    log: ["Analyzed XAUUSD", "Generated article", "Published to blog"],
  },
  {
    id: "run-002",
    workflowId: "wf-002",
    workflowName: "News Digest",
    status: "success",
    startedAt: "2025-01-15T09:00:00Z",
    finishedAt: "2025-01-15T09:00:08Z",
    durationMs: 8000,
    log: ["Summarized 6 stories", "Newsletter sent"],
  },
  {
    id: "run-003",
    workflowId: "wf-001",
    workflowName: "Daily Gold Analysis",
    status: "failed",
    startedAt: "2025-01-14T07:00:00Z",
    finishedAt: "2025-01-14T07:00:05Z",
    durationMs: 5000,
    log: ["Analyzed XAUUSD", "Article generation failed: rate limit"],
  },
];

export const mockQueue: QueueItem[] = [
  { id: "q-001", workflowId: "wf-002", workflowName: "News Digest", enqueuedAt: "2025-01-15T08:59:00Z", status: "queued" },
];