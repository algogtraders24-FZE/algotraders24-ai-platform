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
import { sendPurchaseConfirmationEmail, sendLicenseIssuanceFailureAlert, sendSubscriptionActivationFailureAlert } from "@/services/notifications/EmailService";
import { notifySubscriptionActive } from "@/services/billing/subscriptionNotifications";
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
      const paymentId = body.payment_id;
      try {
        if (!paymentId) throw new Error("NOWPayments IPN missing payment_id - cannot use as an idempotency key");

        const intent = await prisma.marketplacePurchaseIntent.findUnique({ where: { id: intentId } });
        if (intent) {
          // providerRef (paymentId) is the real idempotency guarantee -
          // issueLicenseForPurchase's Purchase.providerRef @unique
          // constraint makes a retried IPN for the same payment a no-op
          // duplicate return, mirroring the Stripe webhook's own pattern
          // (session.id) exactly - see that function's header comment.
          let result: Awaited<ReturnType<typeof issueLicenseForPurchase>>;
          try {
            result = await issueLicenseForPurchase({
              buyerId: intent.buyerId,
              marketplaceListingId: intent.marketplaceListingId,
              tradingSystemId: intent.tradingSystemId,
              versionId: intent.versionId,
              releaseId: intent.releaseId,
              platform: intent.platform as PlatformName,
              amount: intent.amount,
              currency: intent.currency,
              expiresAt: null,
              provider: "nowpayments",
              providerRef: paymentId,
            });
          } catch (issueError) {
            // The buyer's crypto payment already confirmed on-chain at this
            // point - alert the team rather than silently leaving a
            // confirmed payment with no license, same as the Stripe path.
            try {
              const buyer = await prisma.user.findUnique({ where: { id: intent.buyerId }, select: { email: true } });
              await sendLicenseIssuanceFailureAlert({
                buyerEmail: buyer?.email ?? intent.buyerId,
                tradingSystemId: intent.tradingSystemId,
                amount: intent.amount,
                currency: intent.currency,
                providerRef: paymentId,
                errorMessage: issueError instanceof Error ? issueError.message : String(issueError),
              });
            } catch (alertError) {
              console.error("[webhook:nowpayments] license issuance failure alert also failed:", alertError);
            }
            throw issueError;
          }

          await prisma.marketplacePurchaseIntent.update({
            where: { id: intent.id },
            data: { status: "CONSUMED", consumedAt: new Date() },
          });

          if (!result.duplicate) {
            try {
              const [buyer, listing] = await Promise.all([
                prisma.user.findUnique({ where: { id: intent.buyerId }, select: { email: true, name: true } }),
                prisma.marketplaceListing.findUnique({ where: { id: intent.marketplaceListingId }, select: { title: true } }),
              ]);
              if (buyer) {
                await sendPurchaseConfirmationEmail({
                  to: buyer.email,
                  buyerName: buyer.name || "there",
                  productName: listing?.title ?? intent.tradingSystemId,
                  amount: intent.amount,
                  currency: intent.currency,
                  licenseId: result.license.id,
                });
              }
            } catch (emailError) {
              console.error("[webhook:nowpayments] purchase confirmation email failed:", emailError);
            }
          }
        }
      } catch {
        return ApiResponse.error({ code: "WEBHOOK_PROCESSING_FAILED", message: "Could not apply IPN event" }, ctx.requestId, 500, ctx.startedAt);
      }
    } else {
      const parsed = parseOrderId(body.order_id);
      if (parsed) {
        const now = new Date();
        const currentPeriodEnd = addMonths(now, parsed.cycle === "yearly" ? 12 : 1);
        try {
          await subscriptionActionService.activateFromPayment({
            userId: parsed.userId,
            planId: parsed.planId,
            provider: "nowpayments",
            currentPeriodStart: now,
            currentPeriodEnd,
            nowPaymentsInvoiceId: body.payment_id,
          });
        } catch (activationError) {
          // The buyer's crypto payment already confirmed at this point (a
          // real incident: 2026-09-22, a finished NOWPayments subscription
          // payment left the buyer silently on their old plan with zero
          // record anywhere that anything had gone wrong) - alert the team
          // rather than repeating that silently, and still return 500 so
          // NOWPayments retries the IPN.
          try {
            await sendSubscriptionActivationFailureAlert({
              userId: parsed.userId,
              planId: parsed.planId,
              provider: "nowpayments",
              providerRef: body.payment_id ?? body.order_id,
              errorMessage: activationError instanceof Error ? activationError.message : String(activationError),
            });
          } catch (alertError) {
            console.error("[webhook:nowpayments] subscription activation failure alert also failed:", alertError);
          }
          return ApiResponse.error({ code: "WEBHOOK_PROCESSING_FAILED", message: "Could not apply IPN event" }, ctx.requestId, 500, ctx.startedAt);
        }
        // AT24_EMAIL_COMMUNICATION_RECONCILIATION.md's B01/B02 gap, found
        // live: unlike the Stripe subscription path, this branch never told
        // the buyer their subscription was active. Best-effort, never fails
        // the webhook - activation above has already succeeded.
        await notifySubscriptionActive(parsed.userId, parsed.planId, currentPeriodEnd);
      }
    }
  }
  // Non-final statuses (waiting/confirming) and unparseable order ids are a
  // real, deliberate no-op - never activated on anything less than a
  // confirmed/finished payment.

  return ApiResponse.success({ received: true }, ctx.requestId, 200, ctx.startedAt);
});
