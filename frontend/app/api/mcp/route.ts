// app/api/mcp/route.ts
// AT24 MCP v1 - the external, read-only MCP endpoint (Streamable HTTP, stateless).
// Dormant unless MCP_ENABLED=true (instant kill switch: unset it).
// Auth is a per-user bearer API token (never the browser session), so this path
// is intentionally NOT under /api/private and is not covered by proxy.ts.
// See docs/MT5-MCP-V1-TOOL-SPEC.md.

import { handleMcpHttpRequest } from "@/services/mcp/server";
import { buildMcpRegistry } from "@/services/mcp/mcp-registry";
import { createBurstLimiter, createDailyQuotaGate } from "@/services/mcp/quota";
import { prismaMcpAudit, prismaMcpTokenStore, prismaMcpUsageStore } from "@/services/mcp/prisma-stores";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const registry = buildMcpRegistry();
const quota = createDailyQuotaGate(prismaMcpUsageStore);
const burst = createBurstLimiter(60);

function handle(request: Request): Promise<Response> {
  return handleMcpHttpRequest(request, {
    enabled: process.env.MCP_ENABLED === "true",
    registry,
    tokenStore: prismaMcpTokenStore,
    quota,
    audit: prismaMcpAudit,
    burst,
    allowedOrigins: (process.env.MCP_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  });
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
