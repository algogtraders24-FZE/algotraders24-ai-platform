// app/api/private/subscription/route.ts
// Sprint 14E - Active subscription for the authenticated user.
// Sprint L2.5 - Added PATCH for real subscription mutations: cancel,
// reactivate, and change-plan (change-plan only ever persists a transition
// to a $0 plan - see SubscriptionActionService for why paid transitions are
// rejected rather than faked).
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { prisma } from "@/lib/prisma";
import {
  subscriptionActionService,
  PaymentRequiredError,
  SubscriptionNotFoundError,
  InvalidPlanError,
} from "@/services/billing/SubscriptionActionService";

export const GET = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error(
      { code: "UNAUTHORIZED", message: "Authentication required" },
      ctx.requestId,
      401,
      ctx.startedAt
    );
  }

  const row = await prisma.subscription.findFirst({
    where: { userId: sessionUser.profile.id, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });

  const subscription = row
    ? {
        id: row.id,
        userId: row.userId,
        planId: row.planId,
        status: row.status,
        currentPeriodStart: row.currentPeriodStart.toISOString(),
        currentPeriodEnd: row.currentPeriodEnd.toISOString(),
        cancelAtPeriodEnd: row.cancelAtPeriodEnd,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }
    : null;

  return ApiResponse.success(
    { subscription, planId: sessionUser.profile.planId },
    ctx.requestId,
    200,
    ctx.startedAt
  );
});

function serialize(row: {
  id: string;
  userId: string;
  planId: string;
  status: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    userId: row.userId,
    planId: row.planId,
    status: row.status,
    currentPeriodStart: row.currentPeriodStart.toISOString(),
    currentPeriodEnd: row.currentPeriodEnd.toISOString(),
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const PATCH = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error(
      { code: "UNAUTHORIZED", message: "Authentication required" },
      ctx.requestId,
      401,
      ctx.startedAt
    );
  }
  const userId = sessionUser.profile.id;

  const body = (await req.json().catch(() => null)) as
    | { action?: unknown; planId?: unknown }
    | null;
  const action = body?.action;

  if (action !== "cancel" && action !== "reactivate" && action !== "change-plan") {
    return ApiResponse.error(
      { code: "VALIDATION", message: "action must be one of: cancel, reactivate, change-plan" },
      ctx.requestId,
      400,
      ctx.startedAt
    );
  }

  try {
    if (action === "cancel" || action === "reactivate") {
      const updated = await subscriptionActionService.setCancelAtPeriodEnd(userId, action === "cancel");
      return ApiResponse.success({ subscription: serialize(updated) }, ctx.requestId, 200, ctx.startedAt);
    }

    // change-plan
    if (typeof body?.planId !== "string" || body.planId.trim().length === 0) {
      return ApiResponse.error(
        { code: "VALIDATION", message: "planId must be a non-empty string" },
        ctx.requestId,
        400,
        ctx.startedAt
      );
    }
    const updated = await subscriptionActionService.changePlan(userId, body.planId);
    return ApiResponse.success({ subscription: serialize(updated) }, ctx.requestId, 200, ctx.startedAt);
  } catch (error) {
    if (error instanceof PaymentRequiredError) {
      return ApiResponse.error(
        { code: "PAYMENT_REQUIRED", message: error.message },
        ctx.requestId,
        402,
        ctx.startedAt
      );
    }
    if (error instanceof SubscriptionNotFoundError) {
      return ApiResponse.error(
        { code: "NOT_FOUND", message: error.message },
        ctx.requestId,
        404,
        ctx.startedAt
      );
    }
    if (error instanceof InvalidPlanError) {
      return ApiResponse.error(
        { code: "VALIDATION", message: error.message },
        ctx.requestId,
        400,
        ctx.startedAt
      );
    }
    return ApiResponse.error(
      { code: "UPDATE_FAILED", message: "Could not update the subscription" },
      ctx.requestId,
      500,
      ctx.startedAt
    );
  }
});