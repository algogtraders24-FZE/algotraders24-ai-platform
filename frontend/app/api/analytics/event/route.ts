// app/api/analytics/event/route.ts
// Sprint R1.2 - Phase 2: the ONLY analytics endpoint a client may call
// directly. Deliberately public (not under /api/private) since
// "product_view" can happen on the public product page before a visitor
// ever signs up. Restricted to CLIENT_REPORTABLE_EVENT_TYPES only - login,
// email_verified, ai_chat, knowledge_upload, and market_analysis are always
// recorded server-side from the real action they observe, never accepted
// from a request body, so a user can never fabricate their own "first
// login" or inflate usage counts for a feature they didn't actually use.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { analyticsEventService, CLIENT_REPORTABLE_EVENT_TYPES, type AnalyticsEventType } from "@/services/analytics/AnalyticsEventService";

function isClientReportable(value: unknown): value is AnalyticsEventType {
  return typeof value === "string" && (CLIENT_REPORTABLE_EVENT_TYPES as readonly string[]).includes(value);
}

export const POST = withContext(async (req, ctx) => {
  const body = (await req.json().catch(() => null)) as { type?: unknown; metadata?: unknown } | null;
  if (!isClientReportable(body?.type)) {
    return ApiResponse.error(
      { code: "VALIDATION", message: `type must be one of: ${CLIENT_REPORTABLE_EVENT_TYPES.join(", ")}` },
      ctx.requestId,
      400,
      ctx.startedAt,
    );
  }

  const metadata =
    body?.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
      ? (body.metadata as Record<string, unknown>)
      : undefined;

  // Anonymous is fine for product_view; subscription_click always has a
  // real session since it only fires from the authenticated billing page.
  const sessionUser = await getUserOrNull();
  await analyticsEventService.record(sessionUser?.profile.id ?? null, body.type, metadata).catch(() => {});

  return ApiResponse.success({ recorded: true }, ctx.requestId, 200, ctx.startedAt);
});
