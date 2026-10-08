// app/api/live-sync/v1/ingest/route.ts
// AT24 Live Sync (P1) - receives batches from the read-only MT5 Expert Advisor.
// Device-token auth (never the browser session), so it lives outside /api/private
// and is not touched by proxy.ts. Dormant unless LIVE_SYNC_ENABLED=true.
// See docs/LIVE-SYNC-SPEC.md.

import { after } from "next/server";
import { handleLiveSyncRequest } from "@/services/live-sync/handler";
import { runAlertsForAccount } from "@/services/live-sync/alert-runner";
import { prismaDeviceStore, prismaLiveSyncStore } from "@/services/live-sync/prisma-store";
import { createBurstLimiter } from "@/services/mcp/quota";
import { LIMITS } from "@/services/live-sync/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const burst = createBurstLimiter(LIMITS.maxRequestsPerMinute);

function handle(request: Request): Promise<Response> {
  return handleLiveSyncRequest(request, "ingest", {
    enabled: process.env.LIVE_SYNC_ENABLED === "true",
    deviceStore: prismaDeviceStore,
    store: prismaLiveSyncStore,
    burst,
    // Alerts run after the response is sent; they never slow down or fail the EA.
    onSnapshotStored: (info) => after(() => runAlertsForAccount(info.accountId)),
  });
}

export const POST = handle;
export const GET = handle;
export const PUT = handle;
export const DELETE = handle;
