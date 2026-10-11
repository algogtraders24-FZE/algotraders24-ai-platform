// lib/rewards/slots.ts
// (Pure - no I/O.) Monthly slot counting. The database enforces it for real (transaction + unique rows); this is the maths.
import { SLOT_HOLD_MINUTES } from "./config";

/** "2026-11" for a date, in UTC. Slots belong to the month the purchase is made in. */
export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export interface SlotHoldLike {
  status: string; // HELD | CONVERTED | EXPIRED | RELEASED
  expiresAt: Date;
}

/** A hold counts against the limit while it is CONVERTED (became a contract) or HELD and not yet expired. */
export function holdCounts(h: SlotHoldLike, now: Date = new Date()): boolean {
  if (h.status === "CONVERTED") return true;
  if (h.status === "HELD") return h.expiresAt.getTime() > now.getTime();
  return false;
}

export function slotsRemaining(slot: { limit: number; opened: boolean } | null, holds: SlotHoldLike[], now: Date = new Date()): number {
  if (!slot || !slot.opened) return 0;
  const used = holds.filter((h) => holdCounts(h, now)).length;
  return Math.max(0, slot.limit - used);
}

export function holdExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + SLOT_HOLD_MINUTES * 60_000);
}
