// app/api/report-check/v1/complete/route.ts
// The VPS report worker posts the outcome of a claimed job here:
//   { jobId, ok: true,  result: {...compact summary...} }   or   { jobId, ok: false, reason: "<one of the safe reasons>" }
// The result is re-shaped by sanitizeReportCheckResult (known typed fields only) before it is stored, because the listing
// page shows it publicly.
import { sweepAuthorized } from "@/services/live-sync/sweep-auth";
import { completeJob } from "@/services/marketplace/reportCheckStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.REPORT_CHECK_WORKER_SECRET;
  if (!secret || secret.length < 16) return Response.json({ ok: false, code: "DISABLED" }, { status: 503 });
  if (!sweepAuthorized(request.headers.get("authorization"), [secret])) {
    return Response.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
  }
  const text = await request.text();
  if (text.length > 200_000) return Response.json({ ok: false, code: "TOO_LARGE" }, { status: 413 });
  let body: Record<string, unknown> | null = null;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = null;
  }
  const jobId = typeof body?.jobId === "string" ? body.jobId : "";
  if (!jobId) return Response.json({ ok: false, code: "VALIDATION" }, { status: 400 });
  const outcome = body?.ok === true ? ({ ok: true, result: body.result } as const) : ({ ok: false, reason: body?.reason } as const);
  const r = await completeJob(jobId, outcome);
  if (!r.ok) return Response.json({ ok: false, code: r.error }, { status: r.error === "NOT_FOUND" ? 404 : 409 });
  return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}

export const GET = () => Response.json({ ok: false, code: "METHOD" }, { status: 405, headers: { allow: "POST" } });
