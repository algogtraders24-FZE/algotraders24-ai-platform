// app/api/public/live-results/[slug]/route.ts
// PUBLIC, read-only JSON: ONE public Live Results page, exactly the redacted view model the page itself renders
// (percent only unless the owner chose to show amounts on that page). No sign-in, CORS open, cached 60 s.
//   GET /api/public/live-results/<slug>  ->  { status:"ok", data:{ source, disclaimer, results } }
// Only PUBLIC pages are served: a private or unlisted page answers 404, same as a page that does not exist.
import { NextResponse } from "next/server";
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { loadPublicResults, liveResultsEnabled } from "@/services/live-results/prisma-store";
import { SUMMARY_DISCLAIMER } from "@/services/live-results/summary";
import { LISTING_SLUG_RE } from "@/services/live-results/pages";

export const dynamic = "force-dynamic";

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "86400" };

export function OPTIONS(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS });
}

function slugFromPath(path: string): string | undefined {
  const segments = path.split("?")[0]!.split("/").filter(Boolean);
  const idx = segments.indexOf("live-results");
  return idx >= 0 ? segments[idx + 1] : undefined;
}

export const GET = withContext(async (_req, ctx) => {
  if (!liveResultsEnabled()) return ApiResponse.error({ code: "UNAVAILABLE", message: "Live Results is not available yet." }, ctx.requestId, 503, ctx.startedAt);
  const slug = slugFromPath(ctx.path);
  if (!slug || !LISTING_SLUG_RE.test(slug)) return ApiResponse.error({ code: "NOT_FOUND", message: "Page not found" }, ctx.requestId, 404, ctx.startedAt);
  try {
    const found = await loadPublicResults(slug);
    if (!found) return ApiResponse.error({ code: "NOT_FOUND", message: "Page not found" }, ctx.requestId, 404, ctx.startedAt);
    const res = ApiResponse.success({ slug: found.slug, source: "terminal-reported (not independently verified)", disclaimer: SUMMARY_DISCLAIMER, results: found.results }, ctx.requestId, 200, ctx.startedAt);
    for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
    res.headers.set("cache-control", "public, s-maxage=60, stale-while-revalidate=300");
    res.headers.set("x-content-type-options", "nosniff");
    return res;
  } catch {
    return ApiResponse.error({ code: "UNAVAILABLE", message: "Live Results is not available yet." }, ctx.requestId, 503, ctx.startedAt);
  }
});
