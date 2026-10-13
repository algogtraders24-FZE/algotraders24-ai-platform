// services/rewards/addressStore.ts
// (Server only.) The member's saved USDT withdrawal address. Saving or changing it is audited and starts the cooling period; a withdrawal
// is only ever sent to the saved address once that period is over (see lib/rewards/payoutAddress.ts).
import { prisma } from "@/lib/prisma";
import { validatePayoutAddress } from "@/lib/marketplace/earnings";
import { activeFromFor, addressStatusText, effectiveActiveFrom, isAddressActive, maskAddress } from "@/lib/rewards/payoutAddress";

export interface SavedAddress { network: string; address: string; activeFrom: Date }

export async function getSavedAddress(userId: string): Promise<SavedAddress | null> {
  const row = await prisma.rewardPayoutAddress.findUnique({ where: { userId } }).catch(() => null);
  // The wait is judged by today's rule, so lowering it also frees an address that was saved under a longer wait.
  return row ? { network: row.network, address: row.address, activeFrom: effectiveActiveFrom(row.activeFrom, row.updatedAt) } : null;
}

export type SaveResult = { ok: true; activeFrom: Date; unchanged: boolean } | { ok: false; code: string; message: string };

export async function saveAddress(input: { userId: string; network: string; address: string; now?: Date }): Promise<SaveResult> {
  const now = input.now ?? new Date();
  const address = input.address.trim();
  const problem = validatePayoutAddress(input.network, address);
  if (problem) return { ok: false, code: "BAD_ADDRESS", message: problem };

  const existing = await prisma.rewardPayoutAddress.findUnique({ where: { userId: input.userId } });
  if (existing && existing.network === input.network && existing.address === address) return { ok: true, activeFrom: existing.activeFrom, unchanged: true };
  // A withdrawal waiting to be paid keeps the address it was requested with; changing the saved address now only affects the next one.
  const activeFrom = activeFromFor(now);
  await prisma.$transaction([
    prisma.rewardPayoutAddress.upsert({
      where: { userId: input.userId },
      create: { userId: input.userId, network: input.network, address, activeFrom },
      update: { network: input.network, address, activeFrom },
    }),
    prisma.rewardAuditEvent.create({ data: { actor: input.userId, action: existing ? "payout_address.changed" : "payout_address.saved", subjectType: "RewardPayoutAddress", subjectId: input.userId, data: { network: input.network, address: maskAddress(address), activeFrom: activeFrom.toISOString() } } }),
  ]);
  // Best effort: the member is told about every save or change. A failed email never undoes the save.
  try {
    const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { email: true } });
    if (user?.email) {
      const { sendPayoutAddressChangedEmail } = await import("@/services/notifications/EmailService");
      await sendPayoutAddressChangedEmail({ to: user.email, recipientUserId: input.userId, network: input.network, maskedAddress: maskAddress(address), changed: !!existing, usableFromIso: activeFrom.toISOString() });
    }
  } catch (e) {
    console.error("[wallet] address email failed (non-fatal):", e);
  }
  return { ok: true, activeFrom, unchanged: false };
}

/** The saved address as the member sees it: masked, with its status. */
export async function getAddressView(userId: string, now: Date = new Date()): Promise<{ network: string; masked: string; activeFrom: string; status: string } | null> {
  const a = await getSavedAddress(userId);
  return a ? { network: a.network, masked: maskAddress(a.address), activeFrom: a.activeFrom.toISOString(), status: addressStatusText(a.activeFrom, now) } : null;
}

export { isAddressActive };
