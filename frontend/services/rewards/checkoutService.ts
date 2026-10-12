// services/rewards/checkoutService.ts
// (Server only.) Starts an Algo Contracts purchase: re-checks every rule on the server, holds a monthly slot, then creates the
// same MarketplacePurchaseIntent + NOWPayments invoice the marketplace already uses. The contract itself is only created later,
// by the verified-payment webhook (fulfilmentService). Nothing the browser sends is trusted for price, product or eligibility.
import { prisma } from "@/lib/prisma";
import { nowPaymentsProvider } from "@/services/billing/providers/NowPaymentsProvider";
import { PaymentProviderError } from "@/lib/payments/errors";
import { CONTRACT_TERMS_VERSION, REWARD_PRODUCTS, isRewardProductKey, rewardsAllowlist, rewardsMode } from "@/lib/rewards/config";
import { isPlatformOwner } from "@/lib/marketplace/selfServe";
import { canBuyContract } from "@/lib/rewards/eligibility";
import { loadUserFacts } from "@/lib/rewards/access";
import { normalizeReferralCode } from "@/lib/rewards/referral";
import { releaseHold, reserveSlot } from "@/services/rewards/slotStore";

export interface StartCheckoutInput {
  userId: string;
  email: string;
  productKey: unknown;
  acceptTerms: unknown;
  acceptRefundPolicy: unknown;
  /** Raw value of the at24_ref cookie, if any. */
  refCookie?: string | null;
  ip?: string | null;
}

export type StartCheckoutResult =
  | { ok: true; invoiceUrl: string; checkoutId: string }
  | { ok: false; code: string; message: string; status: 400 | 403 | 409 | 502 | 503; reasons?: string[] };

const fail = (code: string, message: string, status: 400 | 403 | 409 | 502 | 503, reasons?: string[]): StartCheckoutResult => ({ ok: false, code, message, status, reasons });

export async function startRewardCheckout(input: StartCheckoutInput): Promise<StartCheckoutResult> {
  if (!isRewardProductKey(input.productKey)) return fail("VALIDATION", "Unknown product.", 400);
  const product = REWARD_PRODUCTS[input.productKey];
  if (product.testOnly && !isPlatformOwner(input.email)) return fail("NOT_AVAILABLE", "This contract is not open yet.", 409);
  if (input.acceptTerms !== true || input.acceptRefundPolicy !== true) {
    return fail("CONSENT_REQUIRED", "Please accept the contract terms and the refund policy to continue.", 400);
  }
  if (!nowPaymentsProvider.isConfigured()) return fail("PROVIDER_UNCONFIGURED", "Payments are not available right now.", 503);

  // Product row: must exist, be switched on, and carry the same price as the code defaults (so a listing edited by mistake can never undercharge).
  const row = await prisma.rewardProduct.findUnique({ where: { key: product.key } }).catch(() => null);
  if (!row || !row.enabled || !row.listingId) return fail("NOT_AVAILABLE", "This contract is not open yet.", 409);
  if (row.listPriceCents !== product.listPriceCents || row.rebateCents !== product.rebateCents) {
    return fail("CONFIG_MISMATCH", "This contract is being updated. Please try again later.", 409);
  }
  const listing = await prisma.marketplaceListing.findFirst({ where: { id: row.listingId, deletedAt: null } });
  const pricing = listing?.pricing as Record<string, unknown> | null;
  if (!listing || !listing.tradingSystemId || !listing.versionId || !pricing || pricing.model !== "one_time" || typeof pricing.amount !== "number") {
    return fail("NOT_AVAILABLE", "This contract is not open yet.", 409);
  }
  if (Math.round((pricing.amount as number) * 100) !== product.listPriceCents) return fail("CONFIG_MISMATCH", "This contract is being updated. Please try again later.", 409);
  const release = await prisma.releaseArtifact.findFirst({
    where: { tradingSystemId: listing.tradingSystemId, versionId: listing.versionId, platform: listing.platformTag, releaseStatus: "PUBLISHED", deletedAt: null },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });
  if (!release) return fail("NOT_AVAILABLE", "The product files are not published yet.", 409);

  // Eligibility (Pro with a real payment, KYC verified, program open for this account). Slot is decided atomically just below.
  const facts = await loadUserFacts(input.userId, input.email);
  const verdict = canBuyContract(facts, { mode: rewardsMode(), allowlist: rewardsAllowlist(), productEnabled: true, slotsRemaining: 1 });
  if (!verdict.ok) return fail("NOT_ELIGIBLE", verdict.reasons[0], 403, verdict.reasons);

  // Referral: the code must exist and belong to someone else. Whether each person in the chain is PAID is decided when the sale is
  // verified (only an active paid Pro plan plus a verified identity earns); the link itself is kept either way, because it is also
  // how the chain above the partner is found.
  let refCode: string | null = null;
  const code = normalizeReferralCode(input.refCookie);
  if (code) {
    const ref = await prisma.referralCode.findUnique({ where: { code } });
    if (ref && ref.userId !== input.userId) refCode = code;
  }

  const slot = await reserveSlot({ userId: input.userId, productKey: product.key });
  if (!slot.ok) {
    return slot.reason === "FULL"
      ? fail("NO_SLOTS", "All slots for this month are taken. Check back when the next month opens.", 409)
      : fail("NO_SLOTS", "This contract is not open this month.", 409);
  }

  try {
    const intent = await prisma.marketplacePurchaseIntent.create({
      data: {
        buyerId: input.userId,
        marketplaceListingId: listing.id,
        tradingSystemId: listing.tradingSystemId,
        versionId: listing.versionId,
        platform: listing.platformTag,
        releaseId: release.id,
        amount: pricing.amount as number,
        currency: (pricing.currency as string | undefined) ?? "USD",
      },
    });
    const checkout = await prisma.rewardCheckout.create({
      data: {
        userId: input.userId,
        productKey: product.key,
        month: slot.month,
        slotHoldId: slot.holdId,
        intentId: intent.id,
        refCode,
        termsVersion: CONTRACT_TERMS_VERSION,
        consentAt: new Date(),
        consentIp: input.ip ?? null,
      },
    });
    const invoice = await nowPaymentsProvider.createMarketplaceInvoice({
      intentId: intent.id,
      priceUsd: pricing.amount as number,
      listingTitle: listing.title,
      listingSlug: listing.slug,
    });
    await prisma.marketplacePurchaseIntent.update({ where: { id: intent.id }, data: { nowPaymentsInvoiceId: invoice.id } });
    return { ok: true, invoiceUrl: invoice.invoiceUrl, checkoutId: checkout.id };
  } catch (error) {
    await releaseHold(slot.holdId).catch(() => undefined);
    const message = error instanceof PaymentProviderError ? error.message : "Could not create the payment invoice.";
    return fail("INVOICE_FAILED", message, error instanceof PaymentProviderError && error.kind === "unconfigured" ? 503 : 502);
  }
}
