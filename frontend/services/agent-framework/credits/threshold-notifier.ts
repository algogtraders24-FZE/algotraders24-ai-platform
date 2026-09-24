// services/agent-framework/credits/threshold-notifier.ts
// AT24 Agent Framework - email audit follow-up (2026-09-24). The real
// CreditThresholdNotifier implementation, wired only into
// createCreditLedger()'s production factory (see credit-ledger.ts's own
// CreditThresholdNotifier interface for why this stays out of the ledger
// itself). Fires at most once per user per billing period per threshold
// (low, then separately exhausted) - deduped via wasEmailAlreadySent, the
// exact mechanism its own doc comment already named this use case for.
//
// EmailLogService/EmailService (both "server-only") are imported
// DYNAMICALLY inside checkThreshold(), not at module top level - a static
// import here would make every consumer of credits/index.ts (which
// statically imports this class) eagerly load a server-only module just by
// importing CreditLedger, even a plain node/tsx script with no
// react-server condition that never touches email at all. Confirmed as a
// real regression while building this: validate-agent-credit.ts went from
// 13/13 passing to a hard crash before this fix. Constructing
// EmailThresholdNotifier itself stays completely free of that cost -
// only an ACTUAL threshold-crossing charge pays for the dynamic import.
import { prisma } from "@/lib/prisma";
import type { CreditThresholdNotifier, CreditBalance } from "./credit-ledger";

// A generous heads-up before a user actually hits zero and AI actions start
// failing - not a locked business number, easy to tune later.
const LOW_BALANCE_RATIO = 0.2;

export class EmailThresholdNotifier implements CreditThresholdNotifier {
  async checkThreshold(userId: string, balance: CreditBalance): Promise<void> {
    if (balance.allowance <= 0) return; // no real allowance to warn against (e.g. an unresolved/edge-case plan)

    const exhausted = balance.balance <= 0;
    const low = !exhausted && balance.balance <= balance.allowance * LOW_BALANCE_RATIO;
    if (!exhausted && !low) return;

    // periodStart, not periodEnd, is the stable key for "this billing
    // period" - it's what the ledger itself sums entries against, so it
    // can't drift between two calls the way a resolved periodEnd could.
    const type = exhausted ? "credits_exhausted" : "credits_low";
    const dedupeKey = `${userId}:${balance.periodStart}`;

    const { wasEmailAlreadySent } = await import("@/services/notifications/EmailLogService");
    const alreadySent = await wasEmailAlreadySent(type, dedupeKey);
    if (alreadySent) return;

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user) return;

    const { sendCreditsLowEmail, sendCreditsExhaustedEmail } = await import("@/services/notifications/EmailService");
    const periodEnd = new Date(balance.periodEnd);
    if (exhausted) {
      await sendCreditsExhaustedEmail({ to: user.email, allowance: balance.allowance, planId: balance.planId, periodEnd, dedupeKey });
    } else {
      await sendCreditsLowEmail({ to: user.email, balance: balance.balance, allowance: balance.allowance, planId: balance.planId, periodEnd, dedupeKey });
    }
  }
}
