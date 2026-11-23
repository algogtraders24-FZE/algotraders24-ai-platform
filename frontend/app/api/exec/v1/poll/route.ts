// app/api/exec/v1/poll/route.ts
// The Execute EA asks for work: answers with the oldest live queued order of the token's owner (marking it "sent"), or order:null.
// Dormant unless EXEC_BRIDGE_ENABLED=true. See docs/EXEC-BRIDGE-PLAN-B-RD-2026-11-23.md.
import { handleExecRequest } from "@/services/exec-bridge/handler";
import { prismaExecStore } from "@/services/exec-bridge/prisma-store";
import { EXEC, execEnabled } from "@/services/exec-bridge/config";
import { createBurstLimiter } from "@/services/mcp/quota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const burst = createBurstLimiter(EXEC.maxRequestsPerMinute);
const handle = (request: Request): Promise<Response> => handleExecRequest(request, "poll", { enabled: execEnabled(), store: prismaExecStore, burst });

export const POST = handle;
export const GET = handle;
export const PUT = handle;
export const DELETE = handle;
