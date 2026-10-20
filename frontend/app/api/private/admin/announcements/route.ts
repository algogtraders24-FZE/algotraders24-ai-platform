// app/api/private/admin/announcements/route.ts
// Admin-only control of product announcements (the "what is new" email to users). Nothing is ever sent automatically.
//   GET    latest announcements + audience size + opt-out count + whether email sending is configured
//   POST   create a DRAFT {subject, preheader?, bodyText, ctaLabel?, ctaUrl?}
//   PATCH  {id, action: "edit" | "test" | "send" | "delete", ...}
//            edit   -> replaces the content (not allowed once sending started)
//            test   -> sends the real email to the admin's own address only
//            send   -> {confirmCount} must equal the current audience size; sends the next batch (call again while !done)
//            delete -> removes a DRAFT
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { prisma } from "@/lib/prisma";
import { audience, optOutCount, sendBatch, sendTest, validateAnnouncement } from "@/services/announcements/service";

export const dynamic = "force-dynamic";

const unavailable = (ctx: { requestId: string; startedAt: number }) =>
  ApiResponse.error({ code: "UNAVAILABLE", message: "Announcements are not available yet (database tables missing?)." }, ctx.requestId, 503, ctx.startedAt);

const clean = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export const GET = withContext(async (_req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;
  try {
    const [items, recipients, optOuts] = await Promise.all([
      prisma.productAnnouncement.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
      audience(),
      optOutCount(),
    ]);
    return ApiResponse.success(
      { announcements: items, audienceCount: recipients.length, optOutCount: optOuts, emailConfigured: !!process.env.RESEND_API_KEY, fromAddress: "support@algotraders24.ai" },
      ctx.requestId,
      200,
      ctx.startedAt,
    );
  } catch {
    return unavailable(ctx);
  }
});

export const POST = withContext(async (req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const content = { subject: clean(b?.subject, 120) ?? "", preheader: clean(b?.preheader, 140), bodyText: typeof b?.bodyText === "string" ? b.bodyText.trim() : "", ctaLabel: clean(b?.ctaLabel, 40), ctaUrl: clean(b?.ctaUrl, 300) };
  const err = validateAnnouncement(content);
  if (err) return ApiResponse.error({ code: "VALIDATION", message: err }, ctx.requestId, 400, ctx.startedAt);
  try {
    const row = await prisma.productAnnouncement.create({ data: { ...content, createdBy: gate.user.profile.email } });
    return ApiResponse.success({ announcement: row }, ctx.requestId, 201, ctx.startedAt);
  } catch {
    return unavailable(ctx);
  }
});

export const PATCH = withContext(async (req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (typeof b?.id !== "string" || typeof b.action !== "string") return ApiResponse.error({ code: "VALIDATION", message: "id and action are required" }, ctx.requestId, 400, ctx.startedAt);
  try {
    const a = await prisma.productAnnouncement.findUnique({ where: { id: b.id } });
    if (!a) return ApiResponse.error({ code: "NOT_FOUND", message: "Announcement not found" }, ctx.requestId, 404, ctx.startedAt);

    if (b.action === "edit") {
      if (a.status !== "DRAFT") return ApiResponse.error({ code: "CONFLICT", message: "Only a draft can be edited" }, ctx.requestId, 409, ctx.startedAt);
      const content = { subject: clean(b.subject, 120) ?? "", preheader: clean(b.preheader, 140), bodyText: typeof b.bodyText === "string" ? b.bodyText.trim() : "", ctaLabel: clean(b.ctaLabel, 40), ctaUrl: clean(b.ctaUrl, 300) };
      const err = validateAnnouncement(content);
      if (err) return ApiResponse.error({ code: "VALIDATION", message: err }, ctx.requestId, 400, ctx.startedAt);
      await prisma.productAnnouncement.update({ where: { id: a.id }, data: content });
      return ApiResponse.success({ ok: true }, ctx.requestId, 200, ctx.startedAt);
    }
    if (b.action === "delete") {
      if (a.status !== "DRAFT") return ApiResponse.error({ code: "CONFLICT", message: "Only a draft can be deleted" }, ctx.requestId, 409, ctx.startedAt);
      await prisma.productAnnouncement.delete({ where: { id: a.id } });
      return ApiResponse.success({ ok: true }, ctx.requestId, 200, ctx.startedAt);
    }
    if (b.action === "test") {
      await sendTest(a.id, gate.user.profile.email, gate.user.profile.id);
      return ApiResponse.success({ ok: true, to: gate.user.profile.email }, ctx.requestId, 200, ctx.startedAt);
    }
    if (b.action === "send") {
      if (a.status === "DRAFT") {
        const count = (await audience()).length;
        if (b.confirmCount !== count) return ApiResponse.error({ code: "CONFLICT", message: `The audience is ${count} users now - confirm that number to send.` }, ctx.requestId, 409, ctx.startedAt);
      }
      const result = await sendBatch(a.id);
      return ApiResponse.success(result, ctx.requestId, 200, ctx.startedAt);
    }
    return ApiResponse.error({ code: "VALIDATION", message: "unknown action" }, ctx.requestId, 400, ctx.startedAt);
  } catch (e) {
    const message = e instanceof Error ? e.message : "failed";
    return ApiResponse.error({ code: "FAILED", message }, ctx.requestId, 500, ctx.startedAt);
  }
});
