// app/api/public/live-results/route.ts
// PUBLIC, read-only JSON: the compact percent-only summary of every PUBLIC Live Results page (no sign-in, CORS open).
//   GET /api/public/live-results   ->  { status:"ok", data:{ generatedAt, source, disclaimer, pages: ResultsSummary[] } }
// Percent only (never money), no ranking by gain, cached for 5 minutes. Deliberately NOT under /api/private.
import { NextResponse } from "next/server";
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { listPublicSummaries, liveResultsEnabled } from "@/services/live-results/prisma-store";
import { SUMMARY_DISCLAIMER } from "@/services/live-results/summary";

export const dynamic = "force-dynamic";

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "86400" };

export function OPTIONS(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export const GET = withContext(async (_req, ctx) => {
  if (!liveResultsEnabled()) return ApiResponse.error({ code: "UNAVAILABLE", message: "Live Results is not available yet." }, ctx.requestId, 503, ctx.startedAt);
  try {
    const pages = await listPublicSummaries();
    const res = ApiResponse.success({ generatedAt: new Date().toISOString(), source: "terminal-reported (not independently verified)", disclaimer: SUMMARY_DISCLAIMER, pages }, ctx.requestId, 200, ctx.startedAt);
    for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
    res.headers.set("cache-control", "public, s-maxage=300, stale-while-revalidate=600");
    res.headers.set("x-content-type-options", "nosniff");
    return res;
  } catch {
    return ApiResponse.error({ code: "UNAVAILABLE", message: "Live Results is not available yet." }, ctx.requestId, 503, ctx.startedAt);
  }
});
