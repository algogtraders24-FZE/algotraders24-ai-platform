// services/billing/subscriptionPaymentLedger.ts
// (Server only.) Writes one SubscriptionPayment row per verified subscription payment so the admin Wallet can report subscription money in.
// Best effort by design: the payment is already confirmed and the plan activated, so a failure here (or the table not being applied yet)
// is logged and never changes the webhook's answer. A replay hits the unique providerRef and is ignored.
import { prisma } from "@/lib/prisma";

export interface SubscriptionPaymentInput {
  userId: string;
  planId: string;
  cycle?: string | null;
  amountUsd: number;
  provider: string;
  providerRef: string;
  paidAt: Date;
}

export async function recordSubscriptionPayment(input: SubscriptionPaymentInput): Promise<void> {
  const amountCents = Math.round(input.amountUsd * 100);
  if (!input.providerRef || !Number.isFinite(amountCents) || amountCents <= 0) return;
  try {
    await prisma.subscriptionPayment.create({
      data: { userId: input.userId, planId: input.planId, cycle: input.cycle ?? null, amountCents, currency: "USD", provider: input.provider, providerRef: input.providerRef, paidAt: input.paidAt },
    });
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    if (code === "P2002") return; // already recorded by an earlier delivery of the same payment
    console.error("[subscription-payments] could not record payment (non-fatal):", e);
  }
}
