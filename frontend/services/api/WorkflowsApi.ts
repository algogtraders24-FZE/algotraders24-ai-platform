// services/api/WorkflowsApi.ts
// Sprint 14E - Typed access to the workflows (automation) private API route.
import { ApiClient, type RequestOptions } from "./ApiClient";
import type { Workflow, AutomationRun, QueueItem } from "@/types/automation";

export interface WorkflowsEnvelope {
  workflows: Workflow[];
  runs: AutomationRun[];
  queue: QueueItem[];
  total: number;
}

const WORKFLOWS_TTL_MS = 30 * 1000;

export class WorkflowsApi {
  static async load(options: RequestOptions = {}): Promise<WorkflowsEnvelope> {
    return ApiClient.get<WorkflowsEnvelope>("/api/private/workflows", {
      cacheTtlMs: WORKFLOWS_TTL_MS,
      retries: 2,
      ...options,
    });
  }
  static invalidate(): void {
    ApiClient.invalidate("/api/private/workflows");
  }
}
