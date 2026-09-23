// services/billing/subscriptionNotifications.ts
// Shared by both payment-provider webhooks (Stripe's checkout.session.completed
// /subscription-mode branch + customer.subscription.updated, and NOWPayments'
// subscription order_id branch) - both call subscriptionActionService.
// activateFromPayment() and both genuinely mean "tell the buyer their plan
// is active through this date." Previously duplicated inline in the Stripe
// webhook only - the NOWPayments webhook had no equivalent call at all,
// meaning a real, successfully-activated crypto subscription never told the
// buyer. Best-effort - never allowed to fail the webhook that already
// succeeded.
import { prisma } from "@/lib/prisma";
import { sendSubscriptionActiveEmail } from "@/services/notifications/EmailService";

export async function notifySubscriptionActive(userId: string, planId: string, periodEnd: Date): Promise<void> {
  try {
    const [buyer, plan] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } }),
      prisma.plan.findUnique({ where: { id: planId }, select: { name: true, priceMonthly: true } }),
    ]);
    if (!buyer || !plan) return;
    await sendSubscriptionActiveEmail({
      to: buyer.email,
      buyerName: buyer.name || "there",
      planName: plan.name,
      amount: plan.priceMonthly,
      currency: "USD",
      periodEnd,
    });
  } catch (error) {
    console.error("[subscription] active email failed:", error);
  }
}
