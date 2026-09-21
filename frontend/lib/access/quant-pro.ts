// lib/access/quant-pro.ts
// Quant Pro production launch - the server-side access gate for Quant Chat
// (app/dashboard/quant-chat) and its two backend actions (compile-only
// MODIFY via /api/private/algo-test/strategy-builder, and the canonical
// compile+run+persist path via /api/private/algo-test/ai-runs).
//
// Reuses the EXISTING platform Plan/Subscription system exactly as locked
// in the Quant Pro launch reconciliation - no new entitlement table, no new
// subscription model. No Plan row's feature list explicitly names "Algo
// Testing" or "Quant" today (verified against prisma/seed.ts), so the real,
// non-invented distinction this checks is the one that already exists
// everywhere else in the platform: paid (any plan priced above the free
// tier) vs free.
//
// Deliberately does NOT trust `User.planId` alone: SubscriptionActionService's
// own webhook-driven markCanceledByProvider()/markPastDueByProvider() update
// Subscription.status but never reset User.planId back to "free" on
// cancellation/past-due - a real, pre-existing gap. Querying the
// Subscription row directly (status + currentPeriodEnd) is the only way to
// get a currently-accurate answer for "is this user paying right now."
import { prisma } from "@/lib/prisma";

export async function hasQuantProAccess(userId: string): Promise<boolean> {
  const subscription = await prisma.subscription.findFirst({
    where: { userId, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!subscription) return false;
  if (subscription.planId === "free") return false;
  if (subscription.status !== "active") return false;
  return subscription.currentPeriodEnd > new Date();
}
