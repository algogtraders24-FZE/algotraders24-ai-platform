// app/api/private/live-sync/devices/route.ts
// Self-service device tokens for the Live Sync EA (session-authenticated).
//   GET    own devices (prefix/name/dates only - never the secret)
//   POST   create; the raw token is returned ONCE and never again
//   DELETE ?id=...  revoke (ingestion with that token stops immediately)
// Every query is scoped to the session user's id.

import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { prisma } from "@/lib/prisma";
import { generateSyncToken } from "@/services/live-sync/crypto";
import { LIMITS } from "@/services/live-sync/contract";

export const dynamic = "force-dynamic";
const MAX_NAME_LEN = 60;

export const GET = withContext(async (_req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  try {
    const rows = await prisma.liveSyncDevice.findMany({
      where: { userId: user.profile.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, name: true, prefix: true, createdAt: true, revokedAt: true, lastSeenAt: true },
    });
    return ApiResponse.success({ devices: rows }, ctx.requestId, 200, ctx.startedAt);
  } catch {
    return ApiResponse.error({ code: "UNAVAILABLE", message: "Live Sync is not available yet." }, ctx.requestId, 503, ctx.startedAt);
  }
});

export const POST = withContext(async (req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  // Explicit consent is required before any token exists: the EA will send trades and balances (real accounts too, if the user enables them) to AT24.
  if ((body as { consent?: unknown })?.consent !== true) {
    return ApiResponse.error({ code: "CONSENT_REQUIRED", message: "Please confirm what Live Sync sends before creating a token." }, ctx.requestId, 400, ctx.startedAt);
  }
  const rawName = typeof (body as { name?: unknown })?.name === "string" ? (body as { name: string }).name.trim() : "";
  const name = rawName.length > 0 ? rawName.slice(0, MAX_NAME_LEN) : "My MT5 terminal";
  try {
    const active = await prisma.liveSyncDevice.count({ where: { userId: user.profile.id, revokedAt: null } });
    if (active >= LIMITS.maxDevicesPerUser) {
      return ApiResponse.error({ code: "DEVICE_LIMIT", message: `You can have at most ${LIMITS.maxDevicesPerUser} active devices. Revoke one first.` }, ctx.requestId, 409, ctx.startedAt);
    }
    const t = generateSyncToken();
    const row = await prisma.liveSyncDevice.create({
      data: { userId: user.profile.id, name, tokenHash: t.tokenHash, prefix: t.prefix },
      select: { id: true, name: true, prefix: true, createdAt: true },
    });
    // The ONLY time the raw token is ever returned.
    return ApiResponse.success({ token: t.raw, ...row }, ctx.requestId, 201, ctx.startedAt);
  } catch {
    return ApiResponse.error({ code: "UNAVAILABLE", message: "Live Sync is not available yet." }, ctx.requestId, 503, ctx.startedAt);
  }
});

export const DELETE = withContext(async (req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return ApiResponse.error({ code: "BAD_REQUEST", message: "id is required" }, ctx.requestId, 400, ctx.startedAt);
  try {
    const r = await prisma.liveSyncDevice.updateMany({ where: { id, userId: user.profile.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (r.count === 0) return ApiResponse.error({ code: "NOT_FOUND", message: "Device not found" }, ctx.requestId, 404, ctx.startedAt);
    return ApiResponse.success({ revoked: true }, ctx.requestId, 200, ctx.startedAt);
  } catch {
    return ApiResponse.error({ code: "UNAVAILABLE", message: "Live Sync is not available yet." }, ctx.requestId, 503, ctx.startedAt);
  }
});
