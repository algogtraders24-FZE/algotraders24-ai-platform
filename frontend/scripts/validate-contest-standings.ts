// scripts/validate-contest-standings.ts - the demo contest scoring on synthetic deals (pure, no DB). Run: npx tsx scripts/validate-contest-standings.ts
import { computeStanding, rankStandings, cleanAlias, readContestRules, DEFAULT_CONTEST_RULES } from "../services/contest/standings";
import type { DealWithMagic } from "../services/live-results/build";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!ok) failed++;
}

const D = (iso: string) => Date.parse(iso + "Z");
const START = D("2026-11-01T00:00:00");
const END = D("2026-12-01T00:00:00");
const MAGIC = "33302";
let pid = 100;

function deposit(iso: string, amount: number): DealWithMagic {
  return { positionId: "0", timeMsc: D(iso), symbol: "", type: "balance", entry: "", volume: 0, price: 0, commission: 0, swap: 0, profit: amount, fee: 0, comment: "", magic: "0" };
}
/** One closed buy trade: open at t, close at t+1h, net P&L = profit. */
function trade(iso: string, profit: number, magic = MAGIC): DealWithMagic[] {
  const id = String(pid++);
  const t = D(iso);
  const base = { positionId: id, symbol: "US30", volume: 1, commission: 0, swap: 0, fee: 0, comment: "", magic };
  return [
    { ...base, timeMsc: t, type: "buy", entry: "in", price: 40000, profit: 0 },
    { ...base, timeMsc: t + 3_600_000, type: "sell", entry: "out", price: 40000 + profit, profit },
  ];
}
function account(list: DealWithMagic[]): DealWithMagic[] {
  return list.sort((a, b) => a.timeMsc - b.timeMsc);
}
const win = { startMs: START, endMs: END };
const rules = { ...DEFAULT_CONTEST_RULES, minTradingDays: 3, minTrades: 3 };

// a healthy entrant: 10,000 start, +3 small wins on 3 different days inside the window = +6%
const good = account([deposit("2026-10-01T00:00:00", 10000), ...trade("2026-11-02T10:00:00", 200), ...trade("2026-11-03T10:00:00", 200), ...trade("2026-11-04T10:00:00", 200)]);
const s1 = computeStanding(good, "hedging", win, MAGIC, rules);
check("profit % is measured against the balance at the window start", s1.scored && Math.abs(s1.profitPct - 6) < 0.01, `(${s1.profitPct})`);
check("a clean entrant is eligible", s1.eligible && s1.reason === null && s1.trades === 3 && s1.tradingDays === 3);

// trades before the window change the start balance but are not scored
const earlier = account([deposit("2026-10-01T00:00:00", 10000), ...trade("2026-10-10T10:00:00", 1000), ...trade("2026-11-02T10:00:00", 110), ...trade("2026-11-03T10:00:00", 110), ...trade("2026-11-04T10:00:00", 110)]);
const s2 = computeStanding(earlier, "hedging", win, MAGIC, rules);
check("start balance includes earlier results; only window trades are scored", Math.abs(s2.profitPct - 3) < 0.01 && s2.trades === 3, `(${s2.profitPct}% on ${s2.trades})`);

// other magic numbers and manual trades are ignored
const mixed = account([deposit("2026-10-01T00:00:00", 10000), ...trade("2026-11-02T10:00:00", 100), ...trade("2026-11-03T10:00:00", 100), ...trade("2026-11-04T10:00:00", 100), ...trade("2026-11-05T10:00:00", 5000, "99999"), ...trade("2026-11-06T10:00:00", 5000, "0")]);
const s3 = computeStanding(mixed, "hedging", win, MAGIC, rules);
check("trades of other magic numbers / manual trades do not count", Math.abs(s3.profitPct - 3) < 0.01 && s3.trades === 3, `(${s3.profitPct}% on ${s3.trades})`);

// breaking the daily loss limit (5%) takes you out of the prizes, but you stay scored
const daily = account([deposit("2026-10-01T00:00:00", 10000), ...trade("2026-11-02T10:00:00", -600), ...trade("2026-11-03T10:00:00", 900), ...trade("2026-11-04T10:00:00", 900), ...trade("2026-11-05T10:00:00", 900)]);
const s4 = computeStanding(daily, "hedging", win, MAGIC, rules);
check("breaking the daily-loss limit makes an entrant ineligible and says when", !s4.eligible && s4.brokenRule === "daily_loss" && /Daily loss/.test(s4.reason ?? "") && s4.profitPct > 0, `(${s4.reason})`);

// max loss limit (10%)
const maxl = account([deposit("2026-10-01T00:00:00", 10000), ...trade("2026-11-02T10:00:00", -400), ...trade("2026-11-03T10:00:00", -400), ...trade("2026-11-04T10:00:00", -300), ...trade("2026-11-05T10:00:00", 4000)]);
const s5 = computeStanding(maxl, "hedging", win, MAGIC, rules);
check("breaking the max-loss limit (cumulative, from the start balance) makes an entrant ineligible", s5.brokenRule === "max_loss" || s5.maxLossUsedPct >= 10 || !s5.eligible, `(${s5.reason})`);

// minimum trading days / trades
const few = account([deposit("2026-10-01T00:00:00", 10000), ...trade("2026-11-02T10:00:00", 100), ...trade("2026-11-02T14:00:00", 100), ...trade("2026-11-02T16:00:00", 100)]);
const s6 = computeStanding(few, "hedging", win, MAGIC, rules);
check("not enough trading days -> not eligible, with the reason", !s6.eligible && /trading day/.test(s6.reason ?? ""), `(${s6.reason})`);
const s7 = computeStanding(good, "hedging", win, MAGIC, { ...rules, minTrades: 10 });
check("not enough trades -> not eligible, with the reason", !s7.eligible && /closed trade/.test(s7.reason ?? ""), `(${s7.reason})`);

// trades closed after the window ends are ignored
const late = account([deposit("2026-10-01T00:00:00", 10000), ...trade("2026-11-02T10:00:00", 100), ...trade("2026-11-03T10:00:00", 100), ...trade("2026-11-04T10:00:00", 100), ...trade("2026-12-02T10:00:00", 9000)]);
check("trades closed after the window are not scored", Math.abs(computeStanding(late, "hedging", win, MAGIC, rules).profitPct - 3) < 0.01);

// nothing to score
check("an account with no balance before the start is not scored", computeStanding(account([...trade("2026-11-02T10:00:00", 100)]), "hedging", win, MAGIC, rules).scored === false);
check("no trades in the window -> not eligible", !computeStanding(account([deposit("2026-10-01T00:00:00", 10000)]), "hedging", win, MAGIC, rules).eligible);

// ranking: eligible by profit desc; ineligible after and unranked
const rows = [
  { row: "A", standing: s1 }, // 6%
  { row: "B", standing: { ...s1, profitPct: 9, maxLossUsedPct: 2 } },
  { row: "C", standing: s4 }, // ineligible but +%
  { row: "D", standing: { ...s1, profitPct: 9, maxLossUsedPct: 1 } }, // ties B on profit, smaller max loss
];
const ranked = rankStandings(rows);
check("ranking: profit desc, tie -> smaller max loss; ineligible entrants are unranked and last", ranked.map((r) => `${r.row}:${r.rank}`).join(",") === "D:1,B:2,A:3,C:null", ranked.map((r) => `${r.row}:${r.rank}`).join(","));

// helpers
check("alias rules", cleanAlias(" Pravin_FX ") === "Pravin_FX" && cleanAlias("ab") === null && cleanAlias("<script>x</script>") === null && cleanAlias("a".repeat(30)) === null);
check("rules read with safe defaults", readContestRules({ dailyLossPct: 3 }).dailyLossPct === 3 && readContestRules(null).maxLossPct === 10 && readContestRules({ minTrades: -5 }).minTrades === DEFAULT_CONTEST_RULES.minTrades);

console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
