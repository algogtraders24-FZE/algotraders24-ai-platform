// app/api/private/admin/rewards/kyc-reminders/route.ts
// Admin: POST { send?: boolean, limit?: number } -> { matched, sent, sample }. By default a DRY RUN: it only counts who would get the
// reminder (active paid plan, no verified identity). Pass send:true to email them. At most 200 per run; each person is emailed once.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { prisma } from "@/lib/prisma";
import { runKycReminders } from "@/services/rewards/kycReminder";

export const maxDuration = 60;

export const POST = withContext(async (req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;
  const b = (await req.json().catch(() => null)) as { send?: unknown; limit?: unknown } | null;
  const send = b?.send === true;
  const limit = typeof b?.limit === "number" && Number.isInteger(b.limit) && b.limit > 0 ? Math.min(b.limit, 200) : 200;
  const result = await runKycReminders({ send, limit });
  await prisma.rewardAuditEvent.create({
    data: { actor: gate.user.profile.id, action: send ? "kyc_reminders.sent" : "kyc_reminders.dry_run", subjectType: "KycReminder", subjectId: "batch", data: { matched: result.matched, sent: result.sent } },
  });
  return ApiResponse.success({ dryRun: !send, ...result }, ctx.requestId, 200, ctx.startedAt);
});
