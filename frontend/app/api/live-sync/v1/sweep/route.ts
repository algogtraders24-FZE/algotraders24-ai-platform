// app/api/live-sync/v1/sweep/route.ts
// Timer endpoint for the "Live Sync stopped reporting" alert. When data stops arriving nothing triggers a check,
// so a small scheduled job (the VPS watchdog) calls this every few minutes with a bearer secret:
// the dedicated LIVE_SYNC_SWEEP_SECRET (preferred) or the platform CRON_SECRET.
// Outside /api/private on purpose: it has its own bearer check and never uses a browser session.
// Dormant unless LIVE_SYNC_ENABLED=true. Reveals nothing about accounts (returns two counters).

import { sweepOfflineAlerts } from "@/services/live-sync/alert-runner";
import { sweepAuthorized } from "@/services/live-sync/sweep-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  if (process.env.LIVE_SYNC_ENABLED !== "true") return Response.json({ ok: false, code: "DISABLED" }, { status: 503 });
  if (!sweepAuthorized(request.headers.get("authorization"), [process.env.LIVE_SYNC_SWEEP_SECRET, process.env.CRON_SECRET])) {
    return Response.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
  }
  const r = await sweepOfflineAlerts(new Date());
  return Response.json({ ok: true, ...r }, { headers: { "cache-control": "no-store" } });
}

export const GET = () => Response.json({ ok: false, code: "METHOD" }, { status: 405, headers: { allow: "POST" } });
