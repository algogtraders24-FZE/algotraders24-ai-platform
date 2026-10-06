// app/api/private/mcp/tokens/route.ts
// AT24 MCP v1 - self-service API token management for the signed-in user.
//   GET    list own tokens (prefix/name/dates only - never the secret)
//   POST   create a token; the raw value is returned ONCE and never again
//   DELETE ?id=...  revoke own token
// Session-authenticated (proxy.ts already enforces login + same-origin on
// state-changing methods for /api/private/*). Every query is scoped to the
// session user's id.

import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { prisma } from "@/lib/prisma";
import { generateMcpToken } from "@/services/mcp/token";

const MAX_ACTIVE_TOKENS = 5;
const MAX_NAME_LEN = 60;
const DEFAULT_EXPIRY_DAYS = 90;

export const GET = withContext(async (_req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  const rows = await prisma.mcpApiToken.findMany({
    where: { userId: user.profile.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, name: true, prefix: true, scopes: true, expiresAt: true, revokedAt: true, lastUsedAt: true, createdAt: true },
  });
  return ApiResponse.success({ tokens: rows }, ctx.requestId, 200, ctx.startedAt);
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
  const rawName = typeof (body as { name?: unknown })?.name === "string" ? (body as { name: string }).name.trim() : "";
  const name = rawName.length > 0 ? rawName.slice(0, MAX_NAME_LEN) : "MCP token";

  const now = new Date();
  const active = await prisma.mcpApiToken.count({
    where: { userId: user.profile.id, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
  });
  if (active >= MAX_ACTIVE_TOKENS) {
    return ApiResponse.error({ code: "TOKEN_LIMIT", message: `You can have at most ${MAX_ACTIVE_TOKENS} active tokens. Revoke one first.` }, ctx.requestId, 409, ctx.startedAt);
  }

  const generated = generateMcpToken();
  const expiresAt = new Date(now.getTime() + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  const row = await prisma.mcpApiToken.create({
    data: { userId: user.profile.id, name, tokenHash: generated.tokenHash, prefix: generated.prefix, scopes: ["read"], expiresAt },
    select: { id: true, name: true, prefix: true, scopes: true, expiresAt: true, createdAt: true },
  });
  // The ONLY time the raw token is ever returned.
  return ApiResponse.success({ token: generated.raw, ...row }, ctx.requestId, 201, ctx.startedAt);
});

export const DELETE = withContext(async (req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return ApiResponse.error({ code: "BAD_REQUEST", message: "id is required" }, ctx.requestId, 400, ctx.startedAt);
  const result = await prisma.mcpApiToken.updateMany({
    where: { id, userId: user.profile.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (result.count === 0) return ApiResponse.error({ code: "NOT_FOUND", message: "Token not found" }, ctx.requestId, 404, ctx.startedAt);
  return ApiResponse.success({ revoked: true }, ctx.requestId, 200, ctx.startedAt);
});
