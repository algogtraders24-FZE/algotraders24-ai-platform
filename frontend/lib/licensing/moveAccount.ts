// lib/licensing/moveAccount.ts
// (Pure policy - no I/O.) "Change trading account": a buyer whose broker or VPS changed can free the account their key is bound to,
// so the NEXT account that runs the EA takes the slot. Limited, so a key cannot be passed around between friends: at most
// MAX_MOVES moves in any rolling WINDOW_DAYS days. Every move is written to the audit log (that log is also the counter).

export const MAX_MOVES = 2;
export const WINDOW_DAYS = 30;
export const MOVE_AUDIT_ACTION = "license.account_moved";

export type MoveVerdict =
  | { allowed: true; remainingAfter: number }
  | { allowed: false; code: "LICENSE_NOT_USABLE" | "NOTHING_TO_MOVE" | "LIMIT_REACHED"; message: string; nextAllowedAt?: Date };

/** `moveTimes` = when this licence was moved before (any order). */
export function moveDecision(input: { licenseStatus: string; activeBindings: number; moveTimes: Date[]; now?: Date }): MoveVerdict {
  const now = input.now ?? new Date();
  if (input.licenseStatus !== "ACTIVE" && input.licenseStatus !== "ISSUED") {
    return { allowed: false, code: "LICENSE_NOT_USABLE", message: "This licence is not active, so its account cannot be changed." };
  }
  if (input.activeBindings === 0) {
    return { allowed: false, code: "NOTHING_TO_MOVE", message: "No account is using this key yet. The first account that runs the EA will take it." };
  }
  const since = now.getTime() - WINDOW_DAYS * 86_400_000;
  const recent = input.moveTimes.filter((t) => t.getTime() >= since).sort((a, b) => a.getTime() - b.getTime());
  if (recent.length >= MAX_MOVES) {
    const nextAllowedAt = new Date(recent[recent.length - MAX_MOVES].getTime() + WINDOW_DAYS * 86_400_000);
    return {
      allowed: false,
      code: "LIMIT_REACHED",
      message: `You can change the trading account ${MAX_MOVES} times in ${WINDOW_DAYS} days. The next change is possible on ${nextAllowedAt.toISOString().slice(0, 10)}. Need it sooner? Contact support.`,
      nextAllowedAt,
    };
  }
  return { allowed: true, remainingAfter: MAX_MOVES - recent.length - 1 };
}

/** How many moves are left right now (for the button label). */
export function movesRemaining(moveTimes: Date[], now: Date = new Date()): number {
  const since = now.getTime() - WINDOW_DAYS * 86_400_000;
  return Math.max(0, MAX_MOVES - moveTimes.filter((t) => t.getTime() >= since).length);
}
