// app/api/report-check/v1/claim/route.ts
// The AT24 VPS report worker polls this over HTTPS (outbound only - no inbound port on the VPS). It gets ONE job plus a
// short-lived signed URL for the seller's report, so the worker never holds storage credentials.
// Outside /api/private on purpose: bearer secret, no browser session. 503 until REPORT_CHECK_WORKER_SECRET is configured.
import { sweepAuthorized } from "@/services/live-sync/sweep-auth";
import { claimNextJob } from "@/services/marketplace/reportCheckStore";
import { createBuildDownloadUrl } from "@/lib/marketplace/buildStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.REPORT_CHECK_WORKER_SECRET;
  if (!secret || secret.length < 16) return Response.json({ ok: false, code: "DISABLED" }, { status: 503 });
  if (!sweepAuthorized(request.headers.get("authorization"), [secret])) {
    return Response.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
  }
  const job = await claimNextJob();
  if (!job) return Response.json({ ok: true, job: null }, { headers: { "cache-control": "no-store" } });
  try {
    const downloadUrl = await createBuildDownloadUrl(job.storageKey);
    return Response.json(
      { ok: true, job: { id: job.id, fileName: job.fileName, sizeBytes: job.sizeBytes, attempt: job.attempts, downloadUrl } },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    // The row stays RUNNING with its lock; it becomes claimable again when the lock expires (attempts are capped).
    return Response.json({ ok: false, code: "STORAGE" }, { status: 502 });
  }
}

export const GET = () => Response.json({ ok: false, code: "METHOD" }, { status: 405, headers: { allow: "POST" } });
