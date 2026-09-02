/**
 * Q0.9 Parts 8/9/10/11/12 - the real execution adapter. This is the only
 * place in the frontend that spawns a process (confirmed nothing else
 * did, in the Q0.9.1 audit). It never execs a shell string and never
 * interpolates user input into a command line - the only things passed
 * to child_process.spawn are a fixed script path and two flags pointing
 * at files this module itself created with server-generated names.
 *
 * Concurrency/queueing here is an in-memory, single-process singleton -
 * correct for the current single dev-server deployment, documented as a
 * Q1 follow-up for a real multi-instance deployment (see
 * Q0.9_JOB_LIFECYCLE.md "Known Limitations").
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import { JOB_RUNNER_SCRIPT } from "./repoPaths";
import { getJob, jobResultOutPath, readJobResultFile, updateJob, writeJobConfig } from "./jobStore";
import { mapEngineOutputToResult, type RawEngineOutput } from "./resultMapper";
import type { BacktestJobErrorCode } from "@/types/quant-lite-job";

const PYTHON_EXECUTABLE = process.env.QUANT_ENGINE_PYTHON || "python";
const MAX_CONCURRENT_BACKTESTS = Number(process.env.QUANT_LITE_MAX_CONCURRENT_BACKTESTS) || 2;
const BACKTEST_TIMEOUT_MS = Number(process.env.QUANT_LITE_BACKTEST_TIMEOUT_MS) || 180_000;
const STDERR_TAIL_LIMIT = 4000;

// Q1.11 - when set, every backtest is forwarded to the remote VPS
// execution service (quant-engine/service/quant_lite_execution_service.py)
// over HTTPS instead of spawning python locally. Unset (the default) means
// this file behaves EXACTLY as it always has - local spawn, no network
// call, no behavior change for local dev or any deployment that hasn't
// opted in. This is deliberately a drop-in swap of *where* the process
// runs, not a rewrite of anything upstream (validation, job store,
// coverage enforcement, result mapping all stay exactly as they are).
const EXEC_SERVICE_URL = process.env.QUANT_LITE_EXEC_SERVICE_URL || "";
const EXEC_SERVICE_SECRET = process.env.QUANT_LITE_EXEC_SECRET || "";
const REMOTE_POLL_INTERVAL_MS = 1500;

// Q0.4/Q0.6's own exact, already-regression-tested values - not yet a
// user-configurable field on BacktestRequest (Q0.7 froze that contract
// without spread/contract-size inputs), so kept as a named server-side
// constant rather than invented per-request.
const SPREAD_PRICE = 0.3;
const CONTRACT_SIZE = 100;

let runningCount = 0;
const queue: string[] = [];

function fail(jobId: string, code: BacktestJobErrorCode, message: string) {
  const startedAt = getJob(jobId)?.startedAt;
  updateJob(jobId, {
    status: "FAILED",
    error: { code, message },
    completedAt: new Date().toISOString(),
    durationMs: startedAt ? Date.now() - new Date(startedAt).getTime() : undefined,
  });
}

function drainQueue() {
  if (runningCount >= MAX_CONCURRENT_BACKTESTS) return;
  const next = queue.shift();
  if (next) void startJob(next);
}

/** Q0.9.6 - enqueue a QUEUED job; starts immediately if a concurrency slot is free. */
export function submitJob(jobId: string): void {
  if (runningCount < MAX_CONCURRENT_BACKTESTS) {
    void startJob(jobId);
  } else {
    queue.push(jobId);
  }
}

async function startJob(jobId: string): Promise<void> {
  const job = getJob(jobId);
  if (!job) return;

  runningCount++;
  const startedAt = new Date().toISOString();
  updateJob(jobId, { status: "RUNNING", startedAt });

  if (EXEC_SERVICE_URL) {
    await runRemote(job, startedAt);
  } else {
    await runLocal(job, startedAt);
  }

  runningCount--;
  drainQueue();
}

/**
 * Q1.11 - forwards the already-validated request to the remote VPS
 * execution service instead of spawning python here. This function does
 * NOT touch the filesystem, does NOT read market.db, and does NOT depend
 * on any quant-engine sibling file - by design, per this sprint's own
 * rule that Vercel must not do any of those things once remote execution
 * is active. Everything it produces (job status transitions, the final
 * BacktestResult, error codes) is written through the exact same
 * updateJob()/fail() calls runLocal() uses, so nothing downstream (the
 * job store, the GET route, the UI) can tell which path ran.
 */
async function runRemote(job: NonNullable<ReturnType<typeof getJob>>, startedAt: string): Promise<void> {
  const jobId = job.jobId;
  const body = {
    jobId: job.jobId,
    requestHash: job.requestHash,
    strategy: job.request.strategy,
    symbol: job.dbSymbol,
    timeframe: job.request.timeframe,
    dateRange: job.request.dateRange,
    initialCapital: job.request.initialCapital,
    riskPct: job.request.riskPct,
    // spreadPrice/contractSize deliberately NOT sent - the remote service
    // pins the same SPREAD_PRICE/CONTRACT_SIZE constants itself, exactly
    // the same trust boundary as the local path (never client-configurable).
  };

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (EXEC_SERVICE_SECRET) headers.Authorization = `Bearer ${EXEC_SERVICE_SECRET}`;

  let remoteJobId: string;
  try {
    const submitRes = await fetch(`${EXEC_SERVICE_URL}/backtest`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000), // the submit call itself should be fast - this is not the backtest's own timeout
    });
    if (!submitRes.ok) {
      const detail = await submitRes.text().catch(() => "");
      // Never forward the remote service's own raw response body verbatim
      // to the client - it may echo back request fields; a fixed, generic
      // message is used instead, same discipline as every other
      // client-facing error in this file.
      fail(jobId, submitRes.status === 401 || submitRes.status === 503 ? "ENGINE_UNREACHABLE" : "ENGINE_ERROR", `remote execution service rejected the request (status ${submitRes.status})`);
      void detail; // intentionally not surfaced to the client; available here only for server-side debugging if this file's own logs are inspected
      return;
    }
    const submitBody = (await submitRes.json()) as { jobId: string };
    remoteJobId = submitBody.jobId;
  } catch (e) {
    fail(jobId, "ENGINE_UNREACHABLE", `could not reach the remote execution service: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }

  const deadline = Date.now() + BACKTEST_TIMEOUT_MS + 15_000; // small grace buffer beyond the remote service's own timeout, for network/poll overhead
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, REMOTE_POLL_INTERVAL_MS));

    let pollBody: { status: string; result?: unknown; error?: { code?: string; message?: string; details?: string[] } };
    try {
      const pollRes = await fetch(`${EXEC_SERVICE_URL}/backtest/${remoteJobId}`, {
        headers: EXEC_SERVICE_SECRET ? { Authorization: `Bearer ${EXEC_SERVICE_SECRET}` } : {},
        signal: AbortSignal.timeout(15_000),
      });
      if (!pollRes.ok) continue; // transient - keep polling until the deadline rather than failing on one bad poll
      pollBody = await pollRes.json();
    } catch {
      continue; // transient network hiccup - keep polling until the deadline
    }

    if (pollBody.status === "QUEUED" || pollBody.status === "RUNNING") continue;

    const durationMs = Date.now() - new Date(startedAt).getTime();

    if (pollBody.status === "FAILED") {
      const knownCodes: BacktestJobErrorCode[] = ["INVALID_REQUEST", "INVALID_STRATEGY", "DATA_UNAVAILABLE", "BACKTEST_FAILED", "BACKTEST_TIMEOUT", "ENGINE_ERROR", "ENGINE_UNREACHABLE", "RESULT_INVALID", "UNKNOWN_ERROR"];
      const errCode = pollBody.error?.code;
      const code = (knownCodes as string[]).includes(errCode ?? "") ? (errCode as BacktestJobErrorCode) : "UNKNOWN_ERROR";
      updateJob(jobId, {
        status: "FAILED",
        error: { code, message: pollBody.error?.message ?? "backtest failed", details: pollBody.error?.details },
        completedAt: new Date().toISOString(),
        durationMs,
      });
      return;
    }

    if (pollBody.status === "COMPLETED") {
      try {
        const result = mapEngineOutputToResult(pollBody.result as RawEngineOutput, job.request.strategy.name || "Untitled strategy", job.dataQuality);
        updateJob(jobId, { status: "COMPLETED", result, completedAt: new Date().toISOString(), durationMs });
      } catch (e) {
        fail(jobId, "RESULT_INVALID", `remote engine result could not be parsed into the result contract: ${e instanceof Error ? e.message : String(e)}`);
      }
      return;
    }

    fail(jobId, "RESULT_INVALID", `remote execution service returned an unrecognized status: ${String(pollBody.status)}`);
    return;
  }

  fail(jobId, "BACKTEST_TIMEOUT", `remote backtest did not complete within the expected time`);
}

async function runLocal(job: NonNullable<ReturnType<typeof getJob>>, startedAt: string): Promise<void> {
  const jobId = job.jobId;
  const config = {
    jobId: job.jobId,
    requestHash: job.requestHash,
    spec: job.request.strategy,
    dbSymbol: job.dbSymbol,
    signalTimeframe: job.request.timeframe,
    execTimeframe: "1m",
    startDate: job.request.dateRange.start,
    endDate: job.request.dateRange.end,
    initialCapital: job.request.initialCapital,
    riskPct: job.request.riskPct,
    spreadPrice: SPREAD_PRICE,
    contractSize: CONTRACT_SIZE,
  };

  let configPath: string;
  let outPath: string;
  try {
    configPath = writeJobConfig(jobId, config);
    outPath = jobResultOutPath(jobId);
  } catch (e) {
    fail(jobId, "ENGINE_ERROR", `could not prepare job input: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }

  await new Promise<void>((resolve) => {
    let stderrTail = "";
    let timedOut = false;

    const child = spawn(PYTHON_EXECUTABLE, [JOB_RUNNER_SCRIPT, "--config", configPath, "--out", outPath], {
      cwd: undefined,
      shell: false,
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      // Windows doesn't reliably honor SIGTERM for a plain node child - a
      // short grace period then SIGKILL ensures no orphan survives.
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // already exited
        }
      }, 2000);
    }, BACKTEST_TIMEOUT_MS);

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-STDERR_TAIL_LIMIT);
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      fail(jobId, "ENGINE_ERROR", `failed to start engine process: ${err.message}`);
      resolve();
    });

    child.on("close", (exitCode) => {
      clearTimeout(timer);
      const durationMs = Date.now() - new Date(startedAt).getTime();

      if (timedOut) {
        fail(jobId, "BACKTEST_TIMEOUT", `backtest exceeded the ${BACKTEST_TIMEOUT_MS}ms timeout and was terminated`);
        updateJob(jobId, { engineExitCode: exitCode, stderrTail, durationMs });
        resolve();
        return;
      }

      const raw = readJobResultFile(jobId) as (RawEngineOutput & { status: string }) | { status: string; errorCode?: string; errorMessage?: string; details?: string[] } | null;

      if (!raw) {
        fail(jobId, "ENGINE_ERROR", `engine process exited (code ${exitCode}) without producing a result file`);
        updateJob(jobId, { engineExitCode: exitCode, stderrTail, durationMs });
        resolve();
        return;
      }

      if (raw.status === "FAILED") {
        const errCode = (raw as { errorCode?: string }).errorCode;
        // Q1.7 Part 9 fix - "INVALID_STRATEGY" is a real code
        // run_backtest_job.py emits (schema.py's validate_spec() rejecting
        // e.g. an undeclared ref like "NaN"/"Infinity" - the Q1.5 Part 11
        // fix) but this list never recognized it, so every such failure
        // silently downgraded to the generic UNKNOWN_ERROR both here and in
        // ResultsView.tsx's ERROR_COPY - not a security gap (the job still
        // correctly fails either way, defense-in-depth was never bypassed)
        // but a real error-classification/UX defect, found via this
        // sprint's own API security re-testing.
        const knownCodes: BacktestJobErrorCode[] = ["INVALID_REQUEST", "INVALID_STRATEGY", "DATA_UNAVAILABLE", "BACKTEST_FAILED", "BACKTEST_TIMEOUT", "ENGINE_ERROR", "RESULT_INVALID", "UNKNOWN_ERROR"];
        const code = (knownCodes as string[]).includes(errCode ?? "") ? (errCode as BacktestJobErrorCode) : "UNKNOWN_ERROR";
        const message = (raw as { errorMessage?: string }).errorMessage ?? "backtest failed";
        updateJob(jobId, {
          status: "FAILED",
          error: { code, message, details: (raw as { details?: string[] }).details },
          engineExitCode: exitCode,
          stderrTail,
          completedAt: new Date().toISOString(),
          durationMs,
        });
        resolve();
        return;
      }

      if (raw.status !== "COMPLETED") {
        fail(jobId, "RESULT_INVALID", `engine produced an unrecognized result status: ${String(raw.status)}`);
        updateJob(jobId, { engineExitCode: exitCode, stderrTail, durationMs });
        resolve();
        return;
      }

      try {
        const result = mapEngineOutputToResult(raw as RawEngineOutput, job.request.strategy.name || "Untitled strategy", job.dataQuality);
        updateJob(jobId, {
          status: "COMPLETED",
          result,
          engineExitCode: exitCode,
          stderrTail,
          completedAt: new Date().toISOString(),
          durationMs,
        });
      } catch (e) {
        fail(jobId, "RESULT_INVALID", `engine result could not be parsed into the result contract: ${e instanceof Error ? e.message : String(e)}`);
        updateJob(jobId, { engineExitCode: exitCode, stderrTail, durationMs });
      }
      resolve();
    });
  });

  // Best-effort cleanup of the per-job scratch files - failure to delete
  // is not itself a job failure, the job record already holds the result.
  try {
    fs.rmSync(configPath, { force: true });
    fs.rmSync(outPath, { force: true });
  } catch {
    // non-fatal
  }
  // runningCount-- / drainQueue() happen in the outer startJob() dispatcher
  // now, not here - runLocal() and runRemote() are siblings under it.
}
