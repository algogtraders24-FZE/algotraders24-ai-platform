// app/api/exec/v1/report/route.ts
// The Execute EA reports what happened to an order it picked up (filled, placed, refused, error), with the ticket or the refusal reason.
import { handleExecRequest } from "@/services/exec-bridge/handler";
import { prismaExecStore } from "@/services/exec-bridge/prisma-store";
import { EXEC, execEnabled } from "@/services/exec-bridge/config";
import { createBurstLimiter } from "@/services/mcp/quota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const burst = createBurstLimiter(EXEC.maxRequestsPerMinute);
const handle = (request: Request): Promise<Response> => handleExecRequest(request, "report", { enabled: execEnabled(), store: prismaExecStore, burst });

export const POST = handle;
export const GET = handle;
export const PUT = handle;
export const DELETE = handle;
