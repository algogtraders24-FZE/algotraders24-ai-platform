// app/api/private/admin/rewards/contracts/[id]/cancel/route.ts
// Admin: POST { reason } -> cancel a contract (fraud, terms breach, or a refund that has to be honoured by law). Unpaid
// instalments are cancelled and their cents returned out of the reserve; amounts already released stay as recorded. The licence
// is NOT touched here - revoke it separately in the licence admin if needed. Every cancellation records who and why.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { cancelContract } from "@/services/rewards/releaseService";

export const POST = withContext(async (req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;
  const segments = new URL(req.url).pathname.split("/").filter(Boolean);
  const contractId = segments[segments.indexOf("contracts") + 1];
  const body = (await req.json().catch(() => null)) as { reason?: unknown } | null;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!contractId || reason.length < 5) {
    return ApiResponse.error({ code: "VALIDATION", message: "A contract id and a reason of at least 5 characters are required." }, ctx.requestId, 400, ctx.startedAt);
  }
  const r = await cancelContract(contractId, reason.slice(0, 300), gate.user.profile.id);
  if (!r.ok) return ApiResponse.error({ code: "NOT_FOUND", message: "Contract not found or already cancelled." }, ctx.requestId, 404, ctx.startedAt);
  return ApiResponse.success({ cancelled: true, returnedCents: r.returnedCents }, ctx.requestId, 200, ctx.startedAt);
});
