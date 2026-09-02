/**
 * Quant Lite backtest service - client-side wrapper around the real
 * backend built in Q0.9 (app/api/quant-lite/backtest/**). Q0.8's mock
 * (always returning the same static Q0.6 sample result) is gone -
 * createBacktestJob() creates a real job that the audited execution_mtf.py
 * engine actually runs, and getBacktestJob() polls its real status.
 */
import type { ApiResponseBody } from "@/types/api";
import type { BacktestRequest, StrategySpec } from "@/types/quant-lite";
import type { CreateBacktestJobResponse, GetBacktestJobResponse } from "@/types/quant-lite-job";
import type { CoverageAssessment } from "@/types/quant-lite-coverage";
import type { CodegenResponse, TargetLanguage } from "@/types/quant-lite-codegen";

export class QuantLiteApiError extends Error {
  code: string;
  details?: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

async function parseApiResponse<T>(res: Response): Promise<T> {
  let body: ApiResponseBody<T>;
  try {
    body = (await res.json()) as ApiResponseBody<T>;
  } catch {
    throw new QuantLiteApiError("UNKNOWN_ERROR", `server returned a non-JSON response (status ${res.status})`);
  }
  if (body.status === "error") {
    throw new QuantLiteApiError(body.error.code, body.error.message, body.error.details);
  }
  return body.data;
}

/** Creates (or reuses an in-flight/completed) real backtest job. Returns immediately - the job runs asynchronously. */
export async function createBacktestJob(request: BacktestRequest): Promise<CreateBacktestJobResponse> {
  const res = await fetch("/api/quant-lite/backtest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  return parseApiResponse<CreateBacktestJobResponse>(res);
}

/** Fetches current job status/result. Callers poll this while status is QUEUED/RUNNING. */
export async function getBacktestJob(jobId: string): Promise<GetBacktestJobResponse> {
  const res = await fetch(`/api/quant-lite/backtest/${encodeURIComponent(jobId)}`);
  return parseApiResponse<GetBacktestJobResponse>(res);
}

/** Q1.1.7 - live, server-authoritative coverage check for a specific request, before submitting a job. */
export async function getCoverageAssessment(symbol: string, timeframe: string, start: string, end: string): Promise<CoverageAssessment> {
  const params = new URLSearchParams({ symbol, timeframe, start, end });
  const res = await fetch(`/api/quant-lite/coverage?${params.toString()}`);
  return parseApiResponse<CoverageAssessment>(res);
}

/** Q1.4 Part 17 - generates MT4/MT5/Pine source for a strategy that already has a real backtest result. Server-authoritative validation + generation. */
export async function generateCode(strategy: StrategySpec, targetLanguage: TargetLanguage): Promise<CodegenResponse> {
  const res = await fetch("/api/quant-lite/codegen", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ strategy, targetLanguage }),
  });
  return parseApiResponse<CodegenResponse>(res);
}

const SPEC_STORAGE_KEY = "quant-lite-draft-spec";

export function saveDraftSpec(spec: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(SPEC_STORAGE_KEY, JSON.stringify(spec));
  } catch {
    // best-effort only - client-only bridge between the Builder and
    // Backtest Setup pages, not real persistence.
  }
}

export function loadDraftSpec<T>(): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(SPEC_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
