// app/api/live-sync/v1/sweep/route.ts
// Timer endpoint for the "Live Sync stopped reporting" alert. When data stops arriving nothing triggers a check,
// so a small scheduled job (the VPS watchdog) calls this every few minutes with the shared CRON_SECRET.
// Outside /api/private on purpose: it has its own bearer check and never uses a browser session.
// Dormant unless LIVE_SYNC_ENABLED=true. Reveals nothing about accounts (returns two counters).

import { timingSafeEqual } from "node:crypto";
import { sweepOfflineAlerts } from "@/services/live-sync/alert-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request): Promise<Response> {
  if (process.env.LIVE_SYNC_ENABLED !== "true") return Response.json({ ok: false, code: "DISABLED" }, { status: 503 });
  if (!authorized(request)) return Response.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
  const r = await sweepOfflineAlerts(new Date());
  return Response.json({ ok: true, ...r }, { headers: { "cache-control": "no-store" } });
}

export const GET = () => Response.json({ ok: false, code: "METHOD" }, { status: 405, headers: { allow: "POST" } });
