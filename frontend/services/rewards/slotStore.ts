// services/rewards/slotStore.ts
// (Server only.) Monthly slots for the Algo Contracts program. The row for (month, product) is locked while a hold is created,
// so two buyers racing for the last slot are serialised and one of them is told it is full. Slots belong to the month the
// purchase is made in (UTC).
import { prisma } from "@/lib/prisma";
import { DEFAULT_SLOTS_PER_MONTH, type RewardProductKey } from "@/lib/rewards/config";
import { holdExpiry, monthKey, slotsRemaining, validateSlotLimits } from "@/lib/rewards/slots";

export type ReserveResult =
  | { ok: true; holdId: string; month: string; expiresAt: Date }
  | { ok: false; reason: "CLOSED" | "FULL" };

export async function reserveSlot(input: { userId: string; productKey: RewardProductKey; now?: Date }): Promise<ReserveResult> {
  const now = input.now ?? new Date();
  const month = monthKey(now);
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ limit: number; opened: boolean }>>`
      SELECT "limit", "opened" FROM reward_slot_months WHERE "month" = ${month} AND "productKey" = ${input.productKey} FOR UPDATE`;
    const slot = locked[0] ?? null;
    if (!slot || !slot.opened) return { ok: false, reason: "CLOSED" } as const;

    await tx.rewardSlotHold.updateMany({
      where: { month, productKey: input.productKey, status: "HELD", expiresAt: { lte: now } },
      data: { status: "EXPIRED" },
    });
    const holds = await tx.rewardSlotHold.findMany({ where: { month, productKey: input.productKey, status: { in: ["HELD", "CONVERTED"] } } });
    // The same user clicking twice reuses their live hold instead of taking a second slot.
    const mine = holds.find((h) => h.userId === input.userId && h.status === "HELD");
    if (mine) {
      const extended = await tx.rewardSlotHold.update({ where: { id: mine.id }, data: { expiresAt: holdExpiry(now) } });
      return { ok: true, holdId: extended.id, month, expiresAt: extended.expiresAt } as const;
    }
    if (slotsRemaining(slot, holds, now) <= 0) return { ok: false, reason: "FULL" } as const;
    const hold = await tx.rewardSlotHold.create({
      data: { month, productKey: input.productKey, userId: input.userId, status: "HELD", expiresAt: holdExpiry(now) },
    });
    return { ok: true, holdId: hold.id, month, expiresAt: hold.expiresAt } as const;
  });
}

export async function releaseHold(holdId: string): Promise<void> {
  await prisma.rewardSlotHold.updateMany({ where: { id: holdId, status: "HELD" }, data: { status: "RELEASED" } });
}

/** Live count for the page and the admin screen (reads only). */
export async function slotSummary(month: string = monthKey(new Date()), now: Date = new Date()) {
  const [slots, holds] = await Promise.all([
    prisma.rewardSlotMonth.findMany({ where: { month } }),
    prisma.rewardSlotHold.findMany({ where: { month, status: { in: ["HELD", "CONVERTED"] } } }),
  ]);
  const byProduct: Record<string, { limit: number; opened: boolean; remaining: number }> = {};
  for (const s of slots) {
    byProduct[s.productKey] = {
      limit: s.limit,
      opened: s.opened,
      remaining: slotsRemaining(s, holds.filter((h) => h.productKey === s.productKey), now),
    };
  }
  return { month, byProduct };
}

/** Admin: open/close a month for a product and set its limit. The whole month stays within the program maximum. */
export async function adminSetSlot(input: { month: string; productKey: RewardProductKey; limit: number; opened: boolean }): Promise<{ ok: true } | { ok: false; message: string }> {
  const others = await prisma.rewardSlotMonth.findMany({ where: { month: input.month, NOT: { productKey: input.productKey } } });
  const limits: Record<string, number> = { [input.productKey]: input.limit };
  for (const o of others) limits[o.productKey] = o.limit;
  const problem = validateSlotLimits(limits, DEFAULT_SLOTS_PER_MONTH);
  if (problem) return { ok: false, message: problem };
  await prisma.rewardSlotMonth.upsert({
    where: { month_productKey: { month: input.month, productKey: input.productKey } },
    update: { limit: input.limit, opened: input.opened },
    create: { month: input.month, productKey: input.productKey, limit: input.limit, opened: input.opened },
  });
  return { ok: true };
}
