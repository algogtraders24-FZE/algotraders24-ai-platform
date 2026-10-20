// app/api/private/admin/social/route.ts
// Admin-only control of the social outbox.
//   GET    latest posts (newest first) + which channels are configured
//   PATCH  body {id, action: "approve" | "skip" | "edit" | "retry", text?}
//            approve -> APPROVED (sent on the next pass, or by "Send now"); skip -> SKIPPED; retry -> APPROVED again with attempts reset;
//            edit    -> replaces the caption (refused when it contains a buy / sell call, target or guarantee)
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { prisma } from "@/lib/prisma";
import { telegramConfig } from "@/services/telegram/config";
import { violatesPolicy } from "@/services/social/content";
import { parseAutoApprove } from "@/services/social/runner";

export const dynamic = "force-dynamic";

const unavailable = (ctx: { requestId: string; startedAt: number }) => ApiResponse.error({ code: "UNAVAILABLE", message: "The social outbox is not available yet." }, ctx.requestId, 503, ctx.startedAt);

export const GET = withContext(async (_req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;
  const tg = telegramConfig();
  const channels = {
    telegram: tg.enabled && !!tg.channelId,
    webhook: !!(process.env.SOCIAL_WEBHOOK_URL ?? "").trim(),
    autoApprove: parseAutoApprove(process.env.SOCIAL_AUTO_APPROVE),
  };
  try {
    const posts = await prisma.socialPost.findMany({ orderBy: { createdAt: "desc" }, take: 40 });
    return ApiResponse.success({ channels, posts }, ctx.requestId, 200, ctx.startedAt);
  } catch {
    return unavailable(ctx);
  }
});

export const PATCH = withContext(async (req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;
  const body = (await req.json().catch(() => null)) as { id?: unknown; action?: unknown; text?: unknown } | null;
  if (typeof body?.id !== "string" || typeof body.action !== "string") return ApiResponse.error({ code: "VALIDATION", message: "id and action are required" }, ctx.requestId, 400, ctx.startedAt);
  try {
    const post = await prisma.socialPost.findUnique({ where: { id: body.id } });
    if (!post) return ApiResponse.error({ code: "NOT_FOUND", message: "Post not found" }, ctx.requestId, 404, ctx.startedAt);
    if (post.status === "SENT") return ApiResponse.error({ code: "CONFLICT", message: "Already sent - a sent post cannot be changed" }, ctx.requestId, 409, ctx.startedAt);

    if (body.action === "approve") {
      const bad = violatesPolicy(post.text);
      if (bad) return ApiResponse.error({ code: "POLICY", message: `Caption ${bad}` }, ctx.requestId, 400, ctx.startedAt);
      await prisma.socialPost.update({ where: { id: post.id }, data: { status: "APPROVED", approvedAt: new Date(), error: null } });
    } else if (body.action === "skip") {
      await prisma.socialPost.update({ where: { id: post.id }, data: { status: "SKIPPED" } });
    } else if (body.action === "retry") {
      await prisma.socialPost.update({ where: { id: post.id }, data: { status: "APPROVED", attempts: 0, error: null } });
    } else if (body.action === "edit") {
      if (typeof body.text !== "string" || body.text.trim().length < 20 || body.text.length > 2200) return ApiResponse.error({ code: "VALIDATION", message: "text must be 20-2200 characters" }, ctx.requestId, 400, ctx.startedAt);
      const bad = violatesPolicy(body.text);
      if (bad) return ApiResponse.error({ code: "POLICY", message: `Caption ${bad}` }, ctx.requestId, 400, ctx.startedAt);
      const text = body.text.trim();
      await prisma.socialPost.update({ where: { id: post.id }, data: { text, shortText: text.slice(0, 900) } });
    } else {
      return ApiResponse.error({ code: "VALIDATION", message: "unknown action" }, ctx.requestId, 400, ctx.startedAt);
    }
    return ApiResponse.success({ ok: true }, ctx.requestId, 200, ctx.startedAt);
  } catch {
    return unavailable(ctx);
  }
});
