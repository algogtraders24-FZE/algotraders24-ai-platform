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

/** Admin input check: each limit a whole number 0 or more, and the whole month never above maxPerMonth (no cap by default; the owner sets slots by hand). */
export function validateSlotLimits(limits: Record<string, number>, maxPerMonth: number): string | null {
  let total = 0;
  for (const [k, v] of Object.entries(limits)) {
    if (!Number.isInteger(v) || v < 0 || v > 1_000_000) return `${k}: the limit must be a whole number from 0 to 1,000,000.`;
    total += v;
  }
  if (total > maxPerMonth) return `A month can hold at most ${maxPerMonth} contracts in total (you set ${total}).`;
  return null;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export function isMonthKey(v: unknown): v is string {
  return typeof v === "string" && MONTH_RE.test(v);
}
