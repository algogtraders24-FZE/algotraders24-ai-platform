// services/licensing/moveAccountStore.ts
// "Change trading account" for a buyer's own licence. DB logic only (no server-only import, so scripts can test it).
// Moves are counted from the audit log rows this function writes (action license.account_moved, targetId = licence id).
import { prisma } from "@/lib/prisma";
import { MOVE_AUDIT_ACTION, WINDOW_DAYS, moveDecision, movesRemaining } from "@/lib/licensing/moveAccount";

async function moveTimesFor(licenseId: string): Promise<Date[]> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);
  const rows = await prisma.auditLog.findMany({ where: { action: MOVE_AUDIT_ACTION, targetType: "License", targetId: licenseId, createdAt: { gte: since } }, select: { createdAt: true } });
  return rows.map((r) => r.createdAt);
}

export interface MoveStatus {
  boundAccounts: { label: string; since: string }[];
  remaining: number;
  nextAllowedAt: string | null;
}

export async function getMoveStatus(licenseId: string, userId: string): Promise<MoveStatus | null> {
  const license = await prisma.license.findUnique({ where: { id: licenseId }, select: { buyerId: true } });
  if (!license || license.buyerId !== userId) return null;
  const [active, times] = await Promise.all([
    prisma.activation.findMany({ where: { licenseId, status: "ACTIVE" }, select: { deviceLabel: true, activatedAt: true } }),
    moveTimesFor(licenseId),
  ]);
  const verdict = moveDecision({ licenseStatus: "ACTIVE", activeBindings: active.length || 1, moveTimes: times });
  return {
    boundAccounts: active.map((a) => ({ label: a.deviceLabel || "Trading account", since: a.activatedAt.toISOString() })),
    remaining: movesRemaining(times),
    nextAllowedAt: !verdict.allowed && verdict.nextAllowedAt ? verdict.nextAllowedAt.toISOString() : null,
  };
}

export type MoveResult = { ok: true; remaining: number } | { ok: false; code: string; message: string; nextAllowedAt?: string };

export async function moveLicenseAccount(licenseId: string, userId: string): Promise<MoveResult> {
  const license = await prisma.license.findUnique({ where: { id: licenseId }, select: { id: true, buyerId: true, licenseStatus: true } });
  if (!license) return { ok: false, code: "NOT_FOUND", message: "Licence not found." };
  if (license.buyerId !== userId) return { ok: false, code: "FORBIDDEN", message: "This licence does not belong to you." };

  return prisma.$transaction(async (tx) => {
    const active = await tx.activation.findMany({ where: { licenseId, status: "ACTIVE" }, select: { id: true, deviceLabel: true } });
    const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);
    const rows = await tx.auditLog.findMany({ where: { action: MOVE_AUDIT_ACTION, targetType: "License", targetId: licenseId, createdAt: { gte: since } }, select: { createdAt: true } });
    const verdict = moveDecision({ licenseStatus: license.licenseStatus, activeBindings: active.length, moveTimes: rows.map((r) => r.createdAt) });
    if (!verdict.allowed) return { ok: false as const, code: verdict.code, message: verdict.message, nextAllowedAt: verdict.nextAllowedAt?.toISOString() };
    const now = new Date();
    await tx.activation.updateMany({ where: { licenseId, status: "ACTIVE" }, data: { status: "DEACTIVATED", deactivatedAt: now } });
    await tx.auditLog.create({
      data: { actorUserId: userId, action: MOVE_AUDIT_ACTION, targetType: "License", targetId: licenseId, metadata: { freed: active.map((a) => a.deviceLabel), result: "OK" } },
    });
    return { ok: true as const, remaining: verdict.remainingAfter };
  });
}
