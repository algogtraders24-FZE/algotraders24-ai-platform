// app/api/quant-lite/backtest/route.ts
// Q0.9 Part 2/4/5/6/7/26 - create (or reuse) a real backtest job. Follows
// this codebase's existing withContext + ApiResponse convention
// (services/backend/Middleware.ts, ApiResponse.ts) exactly as every other
// route under app/api/private/** does.
import crypto from "node:crypto";
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { validateBacktestRequest } from "@/services/quant-lite/backend/validateBacktestRequest";
import { computeRequestHash } from "@/services/quant-lite/backend/requestHash";
import { checkDataCoverage } from "@/services/quant-lite/backend/dataCoverage";
import { createJob, findActiveJobByRequestHash } from "@/services/quant-lite/backend/jobStore";
import { submitJob } from "@/services/quant-lite/backend/executionAdapter";
import { isRemoteExecutionConfigured, submitRemoteJob, RemoteExecutionError } from "@/services/quant-lite/backend/remoteExecutionClient";
import type { BacktestRequest } from "@/types/quant-lite";
import type { BacktestJobRecord, CreateBacktestJobResponse } from "@/types/quant-lite-job";

export const runtime = "nodejs";

export const POST = withContext(async (req, ctx) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return ApiResponse.error({ code: "INVALID_REQUEST", message: "request body must be valid JSON" }, ctx.requestId, 400, ctx.startedAt);
  }

  const validation = validateBacktestRequest(body);
  if (!validation.valid) {
    return ApiResponse.error({ code: "INVALID_REQUEST", message: "request failed validation", details: { errors: validation.errors } }, ctx.requestId, 400, ctx.startedAt);
  }

  const request = body as BacktestRequest;

  // validateBacktestRequest already ran the coverage gate as part of
  // validation and would have rejected an unsupported combo above - this
  // second call just recovers the structured code/message for the
  // response, not a re-check of trust.
  const coverage = checkDataCoverage(request.symbol, request.timeframe, request.dateRange.start, request.dateRange.end);
  if (!coverage.ok || !coverage.assessment) {
    return ApiResponse.error({ code: coverage.code ?? "DATA_UNAVAILABLE", message: coverage.message ?? "requested data is not available" }, ctx.requestId, 422, ctx.startedAt);
  }

  const requestHash = computeRequestHash(request);

  // Q1.12 hotfix - remote mode is a stateless proxy to the VPS's own real
  // job store now (see remoteExecutionClient.ts's own header for why the
  // old local-job-store-based flow broke in real production). Vercel
  // never creates or touches a local job record for a remote-mode
  // request - idempotency/status all live on the VPS, which already
  // implements the identical requestHash-reuse contract.
  if (isRemoteExecutionConfigured()) {
    const jobId = crypto.randomUUID();
    try {
      const responseBody = await submitRemoteJob(jobId, request, requestHash, coverage.assessment);
      return ApiResponse.success(responseBody, ctx.requestId, 202, ctx.startedAt);
    } catch (e) {
      const code = e instanceof RemoteExecutionError ? e.code : "ENGINE_ERROR";
      const status = code === "ENGINE_UNREACHABLE" ? 503 : 500;
      return ApiResponse.error({ code, message: e instanceof Error ? e.message : "could not submit the backtest" }, ctx.requestId, status, ctx.startedAt);
    }
  }

  const existing = findActiveJobByRequestHash(requestHash);
  if (existing) {
    const reused: CreateBacktestJobResponse = { jobId: existing.jobId, status: existing.status, requestHash, reused: true };
    return ApiResponse.success(reused, ctx.requestId, 200, ctx.startedAt);
  }

  const jobId = crypto.randomUUID();
  const now = new Date().toISOString();
  const record: BacktestJobRecord = {
    jobId,
    requestHash,
    status: "QUEUED",
    request,
    dbSymbol: request.symbol,
    createdAt: now,
    dataQuality: coverage.assessment,
  };
  createJob(record);
  submitJob(jobId);

  const responseBody: CreateBacktestJobResponse = { jobId, status: "QUEUED", requestHash, reused: false };
  return ApiResponse.success(responseBody, ctx.requestId, 202, ctx.startedAt);
});
