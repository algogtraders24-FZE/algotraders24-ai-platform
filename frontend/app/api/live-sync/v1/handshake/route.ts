// app/api/live-sync/v1/handshake/route.ts
// AT24 Live Sync (P1) - the EA's first call: validates the device token and returns
// the per-user accountSalt (so the EA can compute accountKey without ever sending
// its login), the minimum sync interval and batch limits.
// Dormant unless LIVE_SYNC_ENABLED=true. See docs/LIVE-SYNC-SPEC.md.

import { handleLiveSyncRequest } from "@/services/live-sync/handler";
import { prismaDeviceStore, prismaLiveSyncStore } from "@/services/live-sync/prisma-store";
import { createBurstLimiter } from "@/services/mcp/quota";
import { LIMITS } from "@/services/live-sync/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const burst = createBurstLimiter(LIMITS.maxRequestsPerMinute);

function handle(request: Request): Promise<Response> {
  return handleLiveSyncRequest(request, "handshake", {
    enabled: process.env.LIVE_SYNC_ENABLED === "true",
    deviceStore: prismaDeviceStore,
    store: prismaLiveSyncStore,
    burst,
  });
}

export const POST = handle;
export const GET = handle;
export const PUT = handle;
export const DELETE = handle;
