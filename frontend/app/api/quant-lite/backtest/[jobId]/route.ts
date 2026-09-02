// app/api/quant-lite/backtest/[jobId]/route.ts
// Q0.9 Part 22/23 - poll job status / fetch the completed result.
// withContext's RouteHandler has no `params` argument, so jobId is parsed
// from ctx.path - the same workaround every other dynamic route in this
// codebase uses (see app/api/private/chart-templates/[id]/route.ts).
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getJob, isValidJobId } from "@/services/quant-lite/backend/jobStore";
import { isRemoteExecutionConfigured, fetchRemoteJob, RemoteExecutionError } from "@/services/quant-lite/backend/remoteExecutionClient";
import type { GetBacktestJobResponse } from "@/types/quant-lite-job";

export const runtime = "nodejs";

function jobIdFromPath(path: string): string | undefined {
  const segments = path.split("/").filter(Boolean);
  const idx = segments.indexOf("backtest");
  return idx >= 0 ? segments[idx + 1] : undefined;
}

export const GET = withContext(async (_req, ctx) => {
  const jobId = jobIdFromPath(ctx.path);

  if (!jobId || !isValidJobId(jobId)) {
    return ApiResponse.error({ code: "INVALID_REQUEST", message: "a valid jobId is required" }, ctx.requestId, 400, ctx.startedAt);
  }

  // Q1.12 hotfix - see remoteExecutionClient.ts's own header. A single,
  // stateless GET to the VPS's own real job store, every request - no
  // local job-store dependency in remote mode at all.
  if (isRemoteExecutionConfigured()) {
    try {
      const remoteJob = await fetchRemoteJob(jobId);
      if (!remoteJob) {
        return ApiResponse.error({ code: "NOT_FOUND", message: "no job found with this id" }, ctx.requestId, 404, ctx.startedAt);
      }
      return ApiResponse.success(remoteJob, ctx.requestId, 200, ctx.startedAt);
    } catch (e) {
      const code = e instanceof RemoteExecutionError ? e.code : "ENGINE_ERROR";
      return ApiResponse.error({ code, message: e instanceof Error ? e.message : "could not reach the remote execution service" }, ctx.requestId, 503, ctx.startedAt);
    }
  }

  const job = getJob(jobId);
  if (!job) {
    return ApiResponse.error({ code: "NOT_FOUND", message: "no job found with this id" }, ctx.requestId, 404, ctx.startedAt);
  }

  const body: GetBacktestJobResponse = {
    jobId: job.jobId,
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    durationMs: job.durationMs,
    result: job.result,
    error: job.error,
    dataQuality: job.dataQuality,
    strategy: job.request?.strategy,
  };
  return ApiResponse.success(body, ctx.requestId, 200, ctx.startedAt);
});
