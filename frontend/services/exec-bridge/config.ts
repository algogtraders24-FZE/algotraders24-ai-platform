// services/exec-bridge/config.ts
// Execute bridge (Plan B): the user presses Confirm on a trade plan in the Pro Chart, the order waits in a short queue, and the user's OWN "AT24 Execute"
// Expert Advisor (inside their own MT5) picks it up and places it. All limits in one place. Off unless EXEC_BRIDGE_ENABLED=true.

export const EXEC = {
  tokenPrefix: "at24_exec_",
  /** A market order that nobody picked up this fast is stale and must not execute later. */
  marketTtlSec: 30,
  limitDefaultMinutes: 60,
  limitMaxMinutes: 24 * 60,
  maxQueuedPerUser: 5,
  maxOrdersPerHour: 20,
  maxDevicesPerUser: 5,
  /** The EA asks this often (seconds); the server also answers it as the minimum. */
  pollSec: 3,
  /** Claimed by the EA but never reported: shown as "unknown, check your terminal" (never re-delivered: that could place it twice). */
  unknownAfterSec: 120,
  /** An EA that polled within this many seconds counts as connected. */
  deviceFreshSec: 90,
  maxBodyBytes: 8 * 1024,
  maxRequestsPerMinute: 60,
  maxReasonLen: 160,
} as const;

/** Master switch. */
export const execEnabled = (): boolean => process.env.EXEC_BRIDGE_ENABLED === "true";
/** Rollout: until EXEC_BRIDGE_PUBLIC=true only admins can create tokens and orders. */
export const execPublic = (): boolean => process.env.EXEC_BRIDGE_PUBLIC === "true";
/** Server-side lot cap per order (the EA has its own, lower input). */
export function execMaxLots(): number {
  const n = Number(process.env.EXEC_MAX_LOTS ?? 0.1);
  return Number.isFinite(n) && n >= 0.01 ? n : 0.1;
}
export const canUseExec = (role: string | undefined): boolean => execEnabled() && (execPublic() || role === "admin");
