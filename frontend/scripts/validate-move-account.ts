// scripts/validate-move-account.ts
// "Change trading account" policy (pure). Run: npx tsx scripts/validate-move-account.ts
import { MAX_MOVES, WINDOW_DAYS, moveDecision, movesRemaining } from "../lib/licensing/moveAccount";

let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
const now = new Date("2026-10-18T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

check(`limit is ${MAX_MOVES} moves in ${WINDOW_DAYS} days`, MAX_MOVES === 2 && WINDOW_DAYS === 30);
const first = moveDecision({ licenseStatus: "ACTIVE", activeBindings: 1, moveTimes: [], now });
check("first move allowed, one left after it", first.allowed && first.remainingAfter === 1);
const second = moveDecision({ licenseStatus: "ACTIVE", activeBindings: 1, moveTimes: [daysAgo(3)], now });
check("second move allowed, none left after it", second.allowed && second.remainingAfter === 0);
const third = moveDecision({ licenseStatus: "ACTIVE", activeBindings: 1, moveTimes: [daysAgo(3), daysAgo(1)], now });
check("third move inside the window is refused", !third.allowed && third.code === "LIMIT_REACHED");
check("the refusal says when the next move is possible (27 days after the older move)", !third.allowed && !!third.nextAllowedAt && third.nextAllowedAt.getTime() === daysAgo(3).getTime() + 30 * 86_400_000);
check("moves older than the window do not count", moveDecision({ licenseStatus: "ACTIVE", activeBindings: 1, moveTimes: [daysAgo(31), daysAgo(45)], now }).allowed);
check("one old + one recent move still leaves one", moveDecision({ licenseStatus: "ACTIVE", activeBindings: 1, moveTimes: [daysAgo(40), daysAgo(2)], now }).allowed);
check("nothing bound yet -> nothing to move (does not burn a move)", (() => { const v = moveDecision({ licenseStatus: "ISSUED", activeBindings: 0, moveTimes: [], now }); return !v.allowed && v.code === "NOTHING_TO_MOVE"; })());
check("revoked / suspended / expired licences cannot be moved", ["REVOKED", "SUSPENDED", "EXPIRED"].every((s) => { const v = moveDecision({ licenseStatus: s, activeBindings: 1, moveTimes: [], now }); return !v.allowed && v.code === "LICENSE_NOT_USABLE"; }));
check("movesRemaining counts only the rolling window", movesRemaining([], now) === 2 && movesRemaining([daysAgo(1)], now) === 1 && movesRemaining([daysAgo(1), daysAgo(2)], now) === 0 && movesRemaining([daysAgo(60)], now) === 2);
check("window edge: a move exactly 30 days ago still counts, 31 days ago does not", movesRemaining([daysAgo(30)], now) === 1 && movesRemaining([daysAgo(31)], now) === 2);

console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
