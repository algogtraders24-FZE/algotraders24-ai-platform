// lib/rewards/payoutAddress.ts
// (Pure - no I/O.) The member's saved USDT withdrawal address. A saved address is the ONLY place a withdrawal can be sent. A newly saved or
// changed address becomes usable after a short cooling period, so someone who gets into an account for a few minutes cannot save their own
// address and withdraw straight away. The member can see the address masked and the moment it becomes usable.
// Owner decision 2026-10-13: the default wait is ZERO (a saved address works at once; every save and change still emails the member and is
// audited, and each withdrawal is checked and paid by hand). REWARDS_ADDRESS_COOLING_HOURS (0-168, whole hours) can add a wait back.

export const DEFAULT_ADDRESS_COOLING_HOURS = 0;
export const MAX_ADDRESS_COOLING_HOURS = 168;

export function addressCoolingHours(raw: string | undefined | null = process.env.REWARDS_ADDRESS_COOLING_HOURS): number {
  const v = raw === undefined || raw === null || raw.trim() === "" ? NaN : Number(raw);
  return Number.isInteger(v) && v >= 0 && v <= MAX_ADDRESS_COOLING_HOURS ? v : DEFAULT_ADDRESS_COOLING_HOURS;
}

/** The moment a saved address becomes usable under TODAY's wait: never later than what was stored, never later than saved-at + the current wait. */
export function effectiveActiveFrom(storedActiveFrom: Date, savedAt: Date, hours: number = addressCoolingHours()): Date {
  const byCurrentRule = new Date(savedAt.getTime() + hours * 3_600_000);
  return byCurrentRule.getTime() < storedActiveFrom.getTime() ? byCurrentRule : storedActiveFrom;
}

/** "TQn9Y2...cbLSE": enough to recognise your own address, not enough to copy it from a screenshot. */
export function maskAddress(address: string): string {
  const a = address.trim();
  if (a.length <= 12) return a;
  return `${a.slice(0, 6)}...${a.slice(-5)}`;
}

export function activeFromFor(now: Date, hours: number = addressCoolingHours()): Date {
  return new Date(now.getTime() + hours * 3_600_000);
}

export function isAddressActive(activeFrom: Date, now: Date): boolean {
  return activeFrom.getTime() <= now.getTime();
}

/** What the member is told about their saved address. */
export function addressStatusText(activeFrom: Date, now: Date): string {
  if (isAddressActive(activeFrom, now)) return "Active";
  const mins = Math.ceil((activeFrom.getTime() - now.getTime()) / 60_000);
  const label = mins >= 60 ? `${Math.ceil(mins / 60)} hours` : `${mins} minutes`;
  return `Usable in about ${label}`;
}
