/**
 * Q1.12 hotfix - a stateless proxy client to the remote VPS execution
 * service, used directly by the API routes when QUANT_LITE_EXEC_SERVICE_URL
 * is configured, INSTEAD of Vercel's own local job store
 * (jobStore.ts/executionAdapter.ts's old runRemote()).
 *
 * Why this exists: the original Q1.11 design had Vercel's POST handler
 * fire-and-forget a background poll loop (executionAdapter.ts's old
 * runRemote()) that wrote the final result into the LOCAL job store, for
 * a later GET request to read back. This broke the moment it ran for
 * real on Vercel: (1) a serverless function does not keep running in the
 * background after its HTTP response is sent, so the poll loop is killed
 * before it ever finishes; (2) even if it somehow ran to completion, a
 * later GET request has no guarantee of landing on the same container -
 * its own local filesystem/os.tmpdir() has no relation to the one the
 * POST request wrote to.
 *
 * The fix: stop trying to make Vercel's own storage the source of truth
 * for remote-mode jobs at all. The VPS's own service already IS a real,
 * persistent, correct job store (proven exhaustively in Q1.10-Q1.12) -
 * every POST here is a single, fast "submit and return immediately" call,
 * and every GET here is a single, fast "ask the VPS what it knows right
 * now" call. No polling loop lives in Vercel's own process at all; the
 * BROWSER does the polling, exactly like it already did for local jobs -
 * each of its GET /api/quant-lite/backtest/[jobId] calls now just proxies
 * through to the VPS's own GET /backtest/{jobId}, stateless, every time.
 */
import { mapEngineOutputToResult, type RawEngineOutput } from "./resultMapper";
import type { BacktestRequest } from "@/types/quant-lite";
import type { CoverageAssessment } from "@/types/quant-lite-coverage";
import type { BacktestJobErrorCode, CreateBacktestJobResponse, GetBacktestJobResponse } from "@/types/quant-lite-job";

const EXEC_SERVICE_URL = process.env.QUANT_LITE_EXEC_SERVICE_URL || "";
const EXEC_SERVICE_SECRET = process.env.QUANT_LITE_EXEC_SECRET || "";

export function isRemoteExecutionConfigured(): boolean {
  return Boolean(EXEC_SERVICE_URL);
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (EXEC_SERVICE_SECRET) headers.Authorization = `Bearer ${EXEC_SERVICE_SECRET}`;
  return headers;
}

const knownErrorCodes: BacktestJobErrorCode[] = [
  "INVALID_REQUEST", "INVALID_STRATEGY", "DATA_UNAVAILABLE", "BACKTEST_FAILED",
  "BACKTEST_TIMEOUT", "ENGINE_ERROR", "ENGINE_UNREACHABLE", "RESULT_INVALID", "UNKNOWN_ERROR",
];

/** POST to the remote service - one fast call, no polling, no local write. */
export async function submitRemoteJob(
  jobId: string,
  request: BacktestRequest,
  requestHash: string,
  dataQuality: CoverageAssessment,
): Promise<CreateBacktestJobResponse> {
  const body = {
    jobId,
    requestHash,
    strategy: request.strategy,
    symbol: request.symbol,
    timeframe: request.timeframe,
    dateRange: request.dateRange,
    initialCapital: request.initialCapital,
    riskPct: request.riskPct,
    dataQuality, // echoed back verbatim by the service on every GET, never used for execution there
  };

  let res: Response;
  try {
    res = await fetch(`${EXEC_SERVICE_URL}/backtest`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new RemoteExecutionError("ENGINE_UNREACHABLE", `could not reach the remote execution service: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (!res.ok) {
    const code: BacktestJobErrorCode = res.status === 401 || res.status === 503 ? "ENGINE_UNREACHABLE" : "ENGINE_ERROR";
    throw new RemoteExecutionError(code, `remote execution service rejected the request (status ${res.status})`);
  }

  const data = (await res.json()) as { jobId: string; status: string; requestHash: string; reused: boolean };
  return { jobId: data.jobId, status: data.status as CreateBacktestJobResponse["status"], requestHash: data.requestHash, reused: data.reused };
}

/** GET from the remote service - one fast call, stateless, every time. Returns null on 404 (job not found, or expired from the VPS's own store). */
export async function fetchRemoteJob(jobId: string): Promise<GetBacktestJobResponse | null> {
  let res: Response;
  try {
    res = await fetch(`${EXEC_SERVICE_URL}/backtest/${jobId}`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new RemoteExecutionError("ENGINE_UNREACHABLE", `could not reach the remote execution service: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new RemoteExecutionError("ENGINE_UNREACHABLE", `remote execution service returned status ${res.status}`);
  }

  const raw = (await res.json()) as {
    jobId: string; status: string; createdAt?: string; startedAt?: string; completedAt?: string; durationMs?: number;
    result?: RawEngineOutput; error?: { code?: string; message?: string; details?: string[] };
    strategy?: BacktestRequest["strategy"]; dataQuality?: CoverageAssessment;
  };

  const body: GetBacktestJobResponse = {
    jobId: raw.jobId,
    status: raw.status as GetBacktestJobResponse["status"],
    createdAt: raw.createdAt ?? new Date().toISOString(),
    startedAt: raw.startedAt,
    completedAt: raw.completedAt,
    durationMs: raw.durationMs,
    dataQuality: raw.dataQuality,
    strategy: raw.strategy,
  };

  if (raw.status === "COMPLETED" && raw.result) {
    try {
      body.result = mapEngineOutputToResult(raw.result, raw.strategy?.name || "Untitled strategy", raw.dataQuality);
    } catch (e) {
      body.status = "FAILED";
      body.error = { code: "RESULT_INVALID", message: `remote engine result could not be parsed into the result contract: ${e instanceof Error ? e.message : String(e)}` };
    }
  } else if (raw.status === "FAILED" && raw.error) {
    const code = (knownErrorCodes as string[]).includes(raw.error.code ?? "") ? (raw.error.code as BacktestJobErrorCode) : "UNKNOWN_ERROR";
    body.error = { code, message: raw.error.message ?? "backtest failed", details: raw.error.details };
  }

  return body;
}

export class RemoteExecutionError extends Error {
  code: BacktestJobErrorCode;
  constructor(code: BacktestJobErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
