// lib/rewards/lifecycle.ts
// (Pure - no I/O.) What state a contract is in, given its instalments. Used by the daily sweep and by the tests.
import type { ContractStatus } from "./eligibility";

export type InstallmentStatus = "SCHEDULED" | "FROZEN" | "RELEASED" | "CANCELLED" | "PAID";

/**
 * The contract status after a sweep:
 *  - REVOKED stays REVOKED, PENDING_DOCUMENT stays PENDING_DOCUMENT (those are changed by their own steps, never by the sweep);
 *  - any FROZEN instalment -> FROZEN (paused and kept, never forfeited), even after the term has ended;
 *  - the term is over and nothing is waiting (no SCHEDULED / FROZEN left) -> ENDED;
 *  - otherwise ACTIVE.
 */
export function contractStatusAfter(current: ContractStatus, instalments: InstallmentStatus[], endsAt: Date, now: Date): ContractStatus {
  if (current === "REVOKED" || current === "PENDING_DOCUMENT") return current;
  if (instalments.includes("FROZEN")) return "FROZEN";
  const waiting = instalments.some((s) => s === "SCHEDULED");
  if (endsAt.getTime() <= now.getTime() && !waiting) return "ENDED";
  return "ACTIVE";
}

/** Cents still owed to the buyer on a contract: instalments not yet released or cancelled. */
export function unreleasedCents(instalments: Array<{ amountCents: number; status: string }>): number {
  return instalments.filter((i) => i.status === "SCHEDULED" || i.status === "FROZEN").reduce((s, i) => s + i.amountCents, 0);
}

/** A purchase in one of these states can no longer carry a contract or a commission. */
export function purchaseVoided(status: string): boolean {
  return status === "REFUNDED" || status === "REVERSED";
}
