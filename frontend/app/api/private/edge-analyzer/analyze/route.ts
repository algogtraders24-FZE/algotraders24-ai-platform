// app/api/private/edge-analyzer/analyze/route.ts
// AT24 Trader Edge Analyzer (E3) - upload an MT5 Trade History Report, get the
// analysis. Session-authenticated; ANALYZE-ONLY: nothing is stored, nothing
// from the file is logged. The browser gzips the file (Vercel's ~4.5 MB body
// limit vs UTF-16 reports), signalled by `x-upload-encoding: gzip`; the file name
// travels in `x-file-name` (URL-encoded). Heavy work is bounded (resample caps).
//
// Plan gating is intentionally NOT applied yet (owner decision pending); the
// per-user rate limit below bounds CPU use meanwhile.

import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { createBurstLimiter } from "@/services/mcp/quota";
import { MAX_WIRE_BYTES, processUpload } from "@/services/edge-analyzer/upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Best-effort per-instance limiter: 6 analyses / minute / user.
const limiter = createBurstLimiter(6);

export const POST = withContext(async (req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);

  if (!limiter.allow(user.profile.id)) {
    return ApiResponse.error({ code: "RATE_LIMITED", message: "Too many analyses. Please wait a minute and try again." }, ctx.requestId, 429, ctx.startedAt);
  }

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_WIRE_BYTES) {
    return ApiResponse.error({ code: "FILE_TOO_LARGE", message: "The file is too large to upload." }, ctx.requestId, 400, ctx.startedAt);
  }

  let fileName = "";
  try {
    fileName = decodeURIComponent(req.headers.get("x-file-name") ?? "");
  } catch {
    fileName = "";
  }
  const gzip = req.headers.get("x-upload-encoding") === "gzip";

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await req.arrayBuffer());
  } catch {
    return ApiResponse.error({ code: "BAD_ENCODING", message: "The upload could not be read." }, ctx.requestId, 400, ctx.startedAt);
  }

  const outcome = processUpload({ fileName, bytes, gzip });
  if (!outcome.ok) {
    return ApiResponse.error({ code: outcome.code, message: outcome.message }, ctx.requestId, outcome.status, ctx.startedAt);
  }
  return ApiResponse.success(outcome.report, ctx.requestId, 200, ctx.startedAt);
});
