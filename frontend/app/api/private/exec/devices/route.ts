// app/api/private/exec/devices/route.ts
// Self-service tokens for the user's own AT24 Execute EA (session-authenticated; admin-only until EXEC_BRIDGE_PUBLIC=true).
//   GET    own tokens (prefix, name, dates; never the secret)    POST create (raw token returned ONCE; explicit consent required)
//   DELETE ?id=...  revoke (the EA stops receiving orders at once)
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { prisma } from "@/lib/prisma";
import { generateExecToken } from "@/services/exec-bridge/token";
import { EXEC, canUseExec } from "@/services/exec-bridge/config";

export const dynamic = "force-dynamic";
const MAX_NAME_LEN = 60;

const unavailable = (ctx: { requestId: string; startedAt: number }) =>
  ApiResponse.error({ code: "UNAVAILABLE", message: "The execute bridge is not available yet." }, ctx.requestId, 503, ctx.startedAt);

export const GET = withContext(async (_req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  if (!canUseExec(user.profile.role)) return ApiResponse.success({ enabled: false, devices: [] }, ctx.requestId, 200, ctx.startedAt);
  try {
    const devices = await prisma.execDevice.findMany({
      where: { userId: user.profile.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, name: true, prefix: true, createdAt: true, revokedAt: true, lastSeenAt: true },
    });
    return ApiResponse.success({ enabled: true, devices }, ctx.requestId, 200, ctx.startedAt);
  } catch {
    return unavailable(ctx);
  }
});

export const POST = withContext(async (req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  if (!canUseExec(user.profile.role)) return ApiResponse.error({ code: "NOT_AVAILABLE", message: "The execute bridge is not open to your account yet." }, ctx.requestId, 403, ctx.startedAt);
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  // The EA places orders in the user's own terminal: explicit consent is required before a token exists.
  if ((body as { consent?: unknown })?.consent !== true) {
    return ApiResponse.error({ code: "CONSENT_REQUIRED", message: "Please confirm that this EA places orders in your MetaTrader only when you press Confirm in the chart." }, ctx.requestId, 400, ctx.startedAt);
  }
  const rawName = typeof (body as { name?: unknown })?.name === "string" ? (body as { name: string }).name.trim() : "";
  const name = rawName.length > 0 ? rawName.slice(0, MAX_NAME_LEN) : "My MT5 terminal";
  try {
    const active = await prisma.execDevice.count({ where: { userId: user.profile.id, revokedAt: null } });
    if (active >= EXEC.maxDevicesPerUser) {
      return ApiResponse.error({ code: "DEVICE_LIMIT", message: `You can have at most ${EXEC.maxDevicesPerUser} active tokens. Revoke one first.` }, ctx.requestId, 409, ctx.startedAt);
    }
    const t = generateExecToken();
    const row = await prisma.execDevice.create({ data: { userId: user.profile.id, name, tokenHash: t.tokenHash, prefix: t.prefix }, select: { id: true, name: true, prefix: true, createdAt: true } });
    return ApiResponse.success({ token: t.raw, ...row }, ctx.requestId, 201, ctx.startedAt); // the ONLY time the raw token is returned
  } catch {
    return unavailable(ctx);
  }
});

export const DELETE = withContext(async (req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return ApiResponse.error({ code: "BAD_REQUEST", message: "id is required" }, ctx.requestId, 400, ctx.startedAt);
  try {
    const r = await prisma.execDevice.updateMany({ where: { id, userId: user.profile.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (r.count === 0) return ApiResponse.error({ code: "NOT_FOUND", message: "Token not found" }, ctx.requestId, 404, ctx.startedAt);
    return ApiResponse.success({ revoked: true }, ctx.requestId, 200, ctx.startedAt);
  } catch {
    return unavailable(ctx);
  }
});
