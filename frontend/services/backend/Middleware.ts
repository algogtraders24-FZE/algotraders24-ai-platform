// services/backend/Middleware.ts
// Sprint 14A — Backend Foundation
// Route handler wrapper: context, logging, timing, error handling.

import { NextResponse } from "next/server";
import { RequestContext } from "./RequestContext";
import { ErrorHandler } from "./ErrorHandler";
import { logger } from "./Logger";

export type RouteHandler = (
  req: Request,
  ctx: RequestContext
) => Promise<NextResponse> | NextResponse;

export function withContext(handler: RouteHandler) {
  return async (req: Request): Promise<NextResponse> => {
    const ctx = RequestContext.fromRequest(req);
    logger.info("Request received", {
      requestId: ctx.requestId,
      method: ctx.method,
      path: ctx.path,
    });

    try {
      const res = await handler(req, ctx);
      logger.info("Request completed", {
        requestId: ctx.requestId,
        durationMs: ctx.elapsedMs(),
      });
      return res;
    } catch (err) {
      return ErrorHandler.handle(err, ctx.requestId, ctx.startedAt);
    }
  };
}
