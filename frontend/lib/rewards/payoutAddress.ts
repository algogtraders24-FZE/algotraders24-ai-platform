// lib/rewards/payoutAddress.ts
// (Pure - no I/O.) The member's saved USDT withdrawal address. A saved address is the ONLY place a withdrawal can be sent. A newly saved or
// changed address becomes usable after a short cooling period, so someone who gets into an account for a few minutes cannot save their own
// address and withdraw straight away. The member can see the address masked and the moment it becomes usable.

export const DEFAULT_ADDRESS_COOLING_HOURS = 24;

/** REWARDS_ADDRESS_COOLING_HOURS (0-24, whole hours) can only SHORTEN the default 24 hours - for testing. */
export function addressCoolingHours(raw: string | undefined | null = process.env.REWARDS_ADDRESS_COOLING_HOURS): number {
  const v = raw === undefined || raw === null || raw.trim() === "" ? NaN : Number(raw);
  return Number.isInteger(v) && v >= 0 && v <= DEFAULT_ADDRESS_COOLING_HOURS ? v : DEFAULT_ADDRESS_COOLING_HOURS;
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
  return `Usable in about ${label} (a new address waits a short while, for your safety)`;
}
