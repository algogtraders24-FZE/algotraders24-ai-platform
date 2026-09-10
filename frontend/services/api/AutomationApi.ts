// services/api/AutomationApi.ts
// AT24 Automation (MVP) - thin client for /api/private/automations/**. The
// UI is a pure view over these responses: the server owns lifecycle
// transitions, run status, credits, condition semantics, schedule
// eligibility, version selection and execution results (AUTOMATION_
// DECISION_LOCK.md). This module never computes any of that.

import type {
  AutomationDetail,
  AutomationListItem,
  AutomationRunDetail,
  AutomationRunSummary,
  AutomationWorkflowDefinition,
} from "@/types/automation";

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const json = (await res.json().catch(() => null)) as
    | { status: "ok"; data: T }
    | { status: "error"; error: { code: string; message: string; details?: unknown } }
    | null;
  if (!json) throw new AutomationApiError(`${res.status} ${res.statusText}`, res.status);
  if (json.status !== "ok") {
    throw new AutomationApiError(json.error.message, res.status, json.error.code, json.error.details);
  }
  return json.data;
}

export class AutomationApiError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AutomationApiError";
  }
}

export interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  overridable: string[];
  definition: AutomationWorkflowDefinition;
}

export const AutomationApi = {
  list: (opts: { includeArchived?: boolean } = {}) =>
    call<{ items: AutomationListItem[]; total: number }>(
      `/api/private/automations${opts.includeArchived ? "?includeArchived=1" : ""}`,
    ),

  get: (id: string) => call<AutomationDetail>(`/api/private/automations/${id}`),

  create: (body: { name: string; description?: string; definition: AutomationWorkflowDefinition }) =>
    call<{ id: string; status: string; version: number }>(`/api/private/automations`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  fromTemplate: (body: { templateId: string; overrides?: { name?: string; symbol?: string } }) =>
    call<{ id: string; status: string; version: number }>(`/api/private/automations/from-template`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  update: (id: string, body: { name?: string; description?: string; definition?: AutomationWorkflowDefinition }) =>
    call<{ id: string; version: number }>(`/api/private/automations/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  transition: (id: string, action: "activate" | "pause" | "resume" | "archive") =>
    call<{ status: string; nextRunAt: string | null }>(`/api/private/automations/${id}/${action}`, { method: "POST" }),

  runNow: (id: string) =>
    call<{ runId: string; status: string }>(`/api/private/automations/${id}/run`, { method: "POST" }),

  duplicate: (id: string) =>
    call<{ id: string }>(`/api/private/automations/${id}/duplicate`, { method: "POST" }),

  runs: (id: string, limit = 20) =>
    call<{ items: AutomationRunSummary[]; total: number }>(`/api/private/automations/${id}/runs?limit=${limit}`),

  templates: () => call<{ items: TemplateSummary[] }>(`/api/private/automations/templates`),

  runDetail: (runId: string) => call<{ run: AutomationRunDetail }>(`/api/private/automation-runs/${runId}`),

  advanceRun: (runId: string) =>
    call<{ run: AutomationRunDetail; terminal: boolean; advanced: boolean }>(
      `/api/private/automation-runs/${runId}/advance`,
      { method: "POST" },
    ),

  cancelRun: (runId: string) =>
    call<{ status: string; cancelRequested: boolean }>(`/api/private/automation-runs/${runId}/cancel`, { method: "POST" }),
};
