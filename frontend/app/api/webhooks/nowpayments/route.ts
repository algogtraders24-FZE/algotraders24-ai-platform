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
import {
  sendPurchaseConfirmationEmail,
  sendLicenseIssuanceFailureAlert,
  sendSubscriptionActivationFailureAlert,
  sendWebhookMetadataMissingAlert,
} from "@/services/notifications/EmailService";
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

  const body = payload as { payment_status?: string; order_id?: string; payment_id?: string; created_at?: string; updated_at?: string };

  // Payment Verification/Hardening - unlike Stripe (whose SDK enforces a
  // 5-minute signature-timestamp tolerance by default), NOWPayments' HMAC
  // signature has no timestamp component at all - a captured, still-
  // validly-signed IPN body could in principle be replayed at any later
  // time. The real functional protection against harm from that is
  // downstream: Purchase.providerRef's DB-level uniqueness makes a replayed
  // marketplace IPN a no-op duplicate, not a second purchase. This is
  // best-effort VISIBILITY only, not a hard reject - deliberately not
  // enforced, because this app cannot fully verify from here that
  // NOWPayments always sends a reliably-present/parseable created_at on
  // every deployment, and a wrong assumption rejecting a real payment would
  // be a worse bug than the gap it's meant to close (see the metadata-
  // missing fix above for exactly that failure class).
  const ipnTimestamp = body.created_at ? new Date(body.created_at) : null;
  if (ipnTimestamp && !Number.isNaN(ipnTimestamp.getTime())) {
    const ageMs = Date.now() - ipnTimestamp.getTime();
    if (ageMs > 48 * 60 * 60 * 1000) {
      console.warn("[webhook:nowpayments] IPN timestamp is unusually old (possible replay, not blocked - idempotency is the real backstop):", {
        orderId: body.order_id,
        paymentId: body.payment_id,
        createdAt: body.created_at,
        ageHours: Math.round(ageMs / (60 * 60 * 1000)),
      });
    }
  }

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
        } else {
          // Payment Verification/Hardening - same silent-skip class as the
          // Stripe metadata gap: NOWPayments confirmed a real payment, but
          // the intentId encoded in order_id matched no MarketplacePurchaseIntent
          // row (deleted, tampered, or a genuinely stale/malformed order_id).
          // Previously this was a pure no-op with zero signal.
          try {
            await sendWebhookMetadataMissingAlert({
              provider: "nowpayments",
              eventContext: "marketplace IPN (intent not found)",
              providerRef: paymentId,
              missingFields: ["marketplacePurchaseIntent"],
              rawMetadata: { orderId: body.order_id, intentId },
            });
          } catch (alertError) {
            console.error("[webhook:nowpayments] metadata-missing alert failed:", alertError);
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
      } else {
        // Payment Verification/Hardening - same silent-skip class again: a
        // finished/confirmed payment whose order_id doesn't parse into a
        // real userId/planId/cycle. Previously a pure no-op.
        try {
          await sendWebhookMetadataMissingAlert({
            provider: "nowpayments",
            eventContext: "subscription IPN (order_id unparseable)",
            providerRef: body.payment_id ?? body.order_id ?? "unknown",
            missingFields: ["userId", "planId"],
            rawMetadata: { orderId: body.order_id },
          });
        } catch (alertError) {
          console.error("[webhook:nowpayments] metadata-missing alert failed:", alertError);
        }
      }
    }
  } else if (body.payment_status && body.order_id) {
    // Payment Verification/Hardening - previously a pure comment, no actual
    // log line: non-final statuses (waiting/confirming/sending) are a real,
    // deliberate no-op (never activate on anything less than confirmed/
    // finished) - visibility logging only, no new business logic. `expired`
    // additionally marks the corresponding MarketplacePurchaseIntent as
    // EXPIRED (a schema value that existed but no code path ever set - a
    // known, already-flagged gap this closes), and `refunded` gets the same
    // "log for manual review, no automated handling" treatment as Stripe's
    // charge.refunded - deliberately NOT a refund-processing feature.
    console.warn("[webhook:nowpayments] non-final/failed payment status:", { status: body.payment_status, orderId: body.order_id, paymentId: body.payment_id });

    if (body.payment_status === "expired" && body.order_id.startsWith("mkt_")) {
      const intentId = body.order_id.slice("mkt_".length);
      try {
        await prisma.marketplacePurchaseIntent.updateMany({
          where: { id: intentId, status: "PENDING" },
          data: { status: "EXPIRED" },
        });
      } catch (error) {
        console.error("[webhook:nowpayments] failed to mark expired intent:", error);
      }
    }

    if (body.payment_status === "refunded") {
      console.warn("[webhook:nowpayments] payment refunded (no automated handling - manual review needed):", { orderId: body.order_id, paymentId: body.payment_id });
    }
  }

  return ApiResponse.success({ received: true }, ctx.requestId, 200, ctx.startedAt);
});
