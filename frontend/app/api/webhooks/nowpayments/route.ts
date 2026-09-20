// app/api/webhooks/nowpayments/route.ts
// Sprint L2.7 - Phase 3/4: real NOWPayments IPN handler. No user auth check
// (NOWPayments calls this directly) - authorization is the HMAC-SHA512
// signature verification (nowPaymentsProvider.verifyIpnSignature), which
// rejects any payload not genuinely signed with this deployment's IPN
// secret. order_id encodes userId/planId/cycle exactly as created in
// crypto-invoice/route.ts - never trusted from any other source.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { nowPaymentsProvider } from "@/services/billing/providers/NowPaymentsProvider";
import { PaymentProviderError } from "@/lib/payments/errors";
import { subscriptionActionService } from "@/services/billing/SubscriptionActionService";
import { isPlanId } from "@/config/plan-limits";
import { prisma } from "@/lib/prisma";
import { issueLicenseForPurchase } from "@/services/licensing/licenseService";
import type { PlatformName } from "@/types/marketplace-factory";

const FINAL_SUCCESS_STATUSES = new Set(["finished", "confirmed"]);

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function parseOrderId(orderId: string): { userId: string; planId: string; cycle: "monthly" | "yearly" } | null {
  const parts = orderId.split(":");
  if (parts.length < 3) return null;
  const [userId, planId, cycle] = parts;
  if (!userId || !planId || !isPlanId(planId)) return null;
  return { userId, planId, cycle: cycle === "yearly" ? "yearly" : "monthly" };
}

export const POST = withContext(async (req, ctx) => {
  if (!nowPaymentsProvider.isConfigured()) {
    return ApiResponse.error({ code: "PROVIDER_UNCONFIGURED", message: "NOWPayments is not configured" }, ctx.requestId, 503, ctx.startedAt);
  }

  const signature = req.headers.get("x-nowpayments-sig");
  const rawBody = await req.text();

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return ApiResponse.error({ code: "VALIDATION", message: "Invalid JSON body" }, ctx.requestId, 400, ctx.startedAt);
  }

  let verified: boolean;
  try {
    verified = nowPaymentsProvider.verifyIpnSignature(payload, signature);
  } catch (error) {
    if (error instanceof PaymentProviderError) {
      return ApiResponse.error({ code: "PROVIDER_UNCONFIGURED", message: error.message }, ctx.requestId, 503, ctx.startedAt);
    }
    verified = false;
  }
  if (!verified) {
    return ApiResponse.error({ code: "INVALID_SIGNATURE", message: "NOWPayments IPN signature verification failed" }, ctx.requestId, 400, ctx.startedAt);
  }

  const body = payload as { payment_status?: string; order_id?: string; payment_id?: string };
  if (body.payment_status && body.order_id && FINAL_SUCCESS_STATUSES.has(body.payment_status)) {
    if (body.order_id.startsWith("mkt_")) {
      const intentId = body.order_id.slice("mkt_".length);
      try {
        // Re-fetched fresh every call, not cached - a retried IPN must see
        // the CONSUMED status the first call just wrote, or it would issue
        // a second license for the same payment.
        const intent = await prisma.marketplacePurchaseIntent.findUnique({ where: { id: intentId } });
        if (intent && intent.status === "PENDING") {
          await issueLicenseForPurchase({
            buyerId: intent.buyerId,
            marketplaceListingId: intent.marketplaceListingId,
            tradingSystemId: intent.tradingSystemId,
            versionId: intent.versionId,
            releaseId: intent.releaseId,
            platform: intent.platform as PlatformName,
            amount: intent.amount,
            currency: intent.currency,
            expiresAt: null,
          });
          await prisma.marketplacePurchaseIntent.update({
            where: { id: intent.id },
            data: { status: "CONSUMED", consumedAt: new Date() },
          });
        }
      } catch {
        return ApiResponse.error({ code: "WEBHOOK_PROCESSING_FAILED", message: "Could not apply IPN event" }, ctx.requestId, 500, ctx.startedAt);
      }
    } else {
      const parsed = parseOrderId(body.order_id);
      if (parsed) {
        try {
          const now = new Date();
          await subscriptionActionService.activateFromPayment({
            userId: parsed.userId,
            planId: parsed.planId,
            provider: "nowpayments",
            currentPeriodStart: now,
            currentPeriodEnd: addMonths(now, parsed.cycle === "yearly" ? 12 : 1),
            nowPaymentsInvoiceId: body.payment_id,
          });
        } catch {
          return ApiResponse.error({ code: "WEBHOOK_PROCESSING_FAILED", message: "Could not apply IPN event" }, ctx.requestId, 500, ctx.startedAt);
        }
      }
    }
  }
  // Non-final statuses (waiting/confirming) and unparseable order ids are a
  // real, deliberate no-op - never activated on anything less than a
  // confirmed/finished payment.

  return ApiResponse.success({ received: true }, ctx.requestId, 200, ctx.startedAt);
});
