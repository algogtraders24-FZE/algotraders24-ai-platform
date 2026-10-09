// app/api/private/admin/telegram/route.ts
// Admin only: drive AT24's own Telegram channel by hand.
//   POST {action:"announce"}            announce new marketplace listings now (same logic as the 5-minute sweep)
//   POST {action:"digest-preview"}      returns the weekly Live Results digest text WITHOUT posting it
//   POST {action:"digest"}              posts the digest now (needs TELEGRAM_CHANNEL_DIGEST=on)
//   POST {action:"post", text}          posts a short plain-text announcement (<= 800 characters, escaped)
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { auditLogService } from "@/services/admin/AuditLogService";
import { announceNewListings, isoWeekKey, postWeeklyDigest, productionChannelDeps } from "@/services/telegram/channel";
import { escapeHtml } from "@/services/telegram/client";
import { digestMessage } from "@/services/telegram/messages";

export const dynamic = "force-dynamic";

export const POST = withContext(async (req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;
  const body = (await req.json().catch(() => null)) as { action?: unknown; text?: unknown } | null;
  const deps = await productionChannelDeps().catch(() => null);
  if (!deps) return ApiResponse.error({ code: "UNAVAILABLE", message: "Telegram is not switched on or no channel id is set." }, ctx.requestId, 503, ctx.startedAt);
  try {
    if (body?.action === "announce") {
      const r = await announceNewListings(deps);
      await auditLogService.record({ actorUserId: gate.user.profile.id, action: "telegram.channel_announce", targetType: "TelegramChannel", targetId: "listings", metadata: { ...r } });
      return ApiResponse.success(r, ctx.requestId, 200, ctx.startedAt);
    }
    if (body?.action === "digest-preview") {
      const rows = (await deps.digestRows()).filter((r) => r.enoughData);
      return ApiResponse.success({ rows: rows.length, text: rows.length > 0 ? digestMessage(rows, deps.siteUrl, isoWeekKey(new Date())) : null }, ctx.requestId, 200, ctx.startedAt);
    }
    if (body?.action === "digest") {
      const posted = await postWeeklyDigest(deps);
      await auditLogService.record({ actorUserId: gate.user.profile.id, action: "telegram.channel_digest", targetType: "TelegramChannel", targetId: "digest", metadata: { posted } });
      return ApiResponse.success({ posted, hint: posted ? undefined : "Nothing posted: the digest is off (TELEGRAM_CHANNEL_DIGEST), already posted this week, or no public page has 30+ trades." }, ctx.requestId, 200, ctx.startedAt);
    }
    if (body?.action === "post") {
      const text = typeof body.text === "string" ? body.text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").trim() : "";
      if (text.length < 3 || text.length > 800) return ApiResponse.error({ code: "BAD_REQUEST", message: "text must be 3 to 800 characters" }, ctx.requestId, 400, ctx.startedAt);
      const res = await deps.client.sendMessage(deps.channelId, escapeHtml(text));
      await auditLogService.record({ actorUserId: gate.user.profile.id, action: "telegram.channel_post", targetType: "TelegramChannel", targetId: "manual", metadata: { ok: res.ok, chars: text.length } });
      if (!res.ok) return ApiResponse.error({ code: "DELIVERY_FAILED", message: res.description ?? "Telegram did not accept the post." }, ctx.requestId, 502, ctx.startedAt);
      return ApiResponse.success({ posted: true }, ctx.requestId, 200, ctx.startedAt);
    }
    return ApiResponse.error({ code: "BAD_REQUEST", message: 'action must be "announce", "digest-preview", "digest" or "post"' }, ctx.requestId, 400, ctx.startedAt);
  } catch {
    return ApiResponse.error({ code: "UNAVAILABLE", message: "Telegram is not available." }, ctx.requestId, 503, ctx.startedAt);
  }
});
