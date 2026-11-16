// scripts/validate-arena-fx.ts
// Validation for the AI Arena maths and the AI answer parser (no network, no database): hand-worked scores, costs, the luck band and
// the verdict, plus sanity checks with known-outcome contestants (perfect foresight must beat the decoys, its mirror must lose to them).
import { COST_ATR, MIN_DAYS_VERDICT, buildArena, cumulative, decoyPosition, hashUnit, percentile, rankAmong, rawMoves, scoreDays, trendPosition, verdictOf, type Pos, type SnapRow } from "../services/arena-fx/engine";
import { buildUserPrompt, parseDecisions, type PromptMarket } from "../services/arena-fx/ai";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!ok) failures += 1;
}
const near = (a: number, b: number, tol = 1e-9): boolean => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const snap = (dayKey: string, symbol: string, price: number, atrPct = 1): SnapRow => ({ dayKey, symbol, price, atrPct, alignment: "mixed" });

// ---- decoys are deterministic and fair --------------------------------------------------------------------------------------
check("hash is deterministic and in [0, 1)", hashUnit("a|b|c") === hashUnit("a|b|c") && hashUnit("x") >= 0 && hashUnit("x") < 1);
const counts = { "-1": 0, "0": 0, "1": 0 };
for (let i = 0; i < 6000; i++) counts[String(decoyPosition(1 + (i % 50), `2026-01-${String((i % 28) + 1).padStart(2, "0")}`, `S${i % 22}`)) as "-1" | "0" | "1"] += 1;
check("decoy positions are about a third each", Object.values(counts).every((c) => c > 1800 && c < 2200), JSON.stringify(counts));
check("different seeds differ", Array.from({ length: 40 }, (_, d) => decoyPosition(1, `d${d}`, "EURUSD") === decoyPosition(2, `d${d}`, "EURUSD")).filter(Boolean).length < 30);
check("trend rule follows the alignment", trendPosition("aligned up") === 1 && trendPosition("aligned down") === -1 && trendPosition("mixed") === 0);

// ---- raw moves and a position by hand ---------------------------------------------------------------------------------------
const snaps = [snap("2026-01-01", "EURUSD", 100), snap("2026-01-02", "EURUSD", 101), snap("2026-01-05", "EURUSD", 100)]; // a weekend gap between day 2 and 3
const raws = rawMoves(snaps);
check("raw move in ATR units, last snapshot has none", near(raws.get("2026-01-01|EURUSD") ?? NaN, 1) && near(raws.get("2026-01-02|EURUSD") ?? NaN, (100 * (100 / 101 - 1)) / 1) && raws.get("2026-01-05|EURUSD") === null);
const long = scoreDays(snaps, raws, () => 1);
check("always long: day 1 pays the entry cost, day 2 holds for free, day 3 is not scored", long.length === 2 && near(long[0].pnl, 1 - COST_ATR) && near(long[1].pnl, (100 * (100 / 101 - 1)) / 1));
const flip = scoreDays(snaps, raws, (s) => (s.dayKey === "2026-01-01" ? 1 : -1) as Pos);
check("a flip costs twice", near(flip[1].pnl, -1 * ((100 * (100 / 101 - 1)) / 1) - COST_ATR * 2));
const flat = scoreDays(snaps, raws, () => 0);
check("flat earns and costs nothing", flat.every((d) => d.pnl === 0));
// two markets on one day: the day is the average
const two = [snap("d1", "A", 100), snap("d2", "A", 102), snap("d1", "B", 50, 2), snap("d2", "B", 49, 2)];
const r2 = rawMoves(two);
const dayTwo = scoreDays(two, r2, () => 1);
// A: raw 2, pnl 2 - 0.03; B: raw (49/50 - 1) * 100 / 2 = -1, pnl -1 - 0.03; average = (1.97 - 1.03) / 2 = 0.47
check("a day averages its markets", dayTwo.length === 1 && near(dayTwo[0].pnl, 0.47));
check("cumulative sums the days", JSON.stringify(cumulative([{ dayKey: "a", pnl: 1 }, { dayKey: "b", pnl: -0.5 }])) === JSON.stringify([1, 0.5]));

// ---- rank, percentile and verdict -------------------------------------------------------------------------------------------
check("rank counts decoys below, a tie counts half", rankAmong(5, [1, 2, 3, 4]) === 100 && rankAmong(0, [1, 2]) === 0 && rankAmong(2, [1, 2, 3, 2]) === 50 && rankAmong(1, []) === null);
check("percentile interpolates", near(percentile([0, 10, 20, 30, 40], 0.5), 20) && near(percentile([0, 10], 0.25), 2.5));
check("verdict needs 30 days and a rank at the edge", verdictOf(29, 99) === "COLLECTING" && verdictOf(MIN_DAYS_VERDICT, 97.5) === "AHEAD OF LUCK ON THIS HISTORY" && verdictOf(30, 2.5) === "BEHIND LUCK ON THIS HISTORY" && verdictOf(30, 60) === "INSIDE THE LUCK BAND" && verdictOf(40, null) === "COLLECTING");

// ---- known-outcome contestants on a synthetic random walk -------------------------------------------------------------------
let seed = 12345;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const symbols = Array.from({ length: 12 }, (_, i) => `M${i}`);
const synth: SnapRow[] = [];
const price = new Map(symbols.map((s) => [s, 100]));
for (let d = 0; d < 45; d++) {
  const dayKey = `2026-03-${String(d + 1).padStart(2, "0")}`;
  for (const s of symbols) {
    synth.push({ dayKey, symbol: s, price: price.get(s) as number, atrPct: 1, alignment: "mixed" });
    price.set(s, (price.get(s) as number) * (1 + (rnd() - 0.5) * 0.02));
  }
}
const sraws = rawMoves(synth);
const board = buildArena(synth, [
  { id: "oracle", label: "perfect foresight", kind: "rule", positionOf: (s) => ((sraws.get(`${s.dayKey}|${s.symbol}`) ?? 0) > 0 ? 1 : -1) as Pos },
  { id: "mirror", label: "always wrong", kind: "rule", positionOf: (s) => ((sraws.get(`${s.dayKey}|${s.symbol}`) ?? 0) > 0 ? -1 : 1) as Pos },
  { id: "flat", label: "does nothing", kind: "rule", positionOf: () => 0 },
]);
const oracle = board.contestants[0];
const mirror = board.contestants[1];
const flatC = board.contestants[2];
check("44 scored days from 45 snapshot days", board.dayKeys.length === 44 && oracle.days === 44, `(${board.dayKeys.length})`);
check("perfect foresight ranks above every decoy and is AHEAD", oracle.rankPct === 100 && oracle.verdict === "AHEAD OF LUCK ON THIS HISTORY");
check("always wrong ranks below every decoy and is BEHIND", mirror.rankPct === 0 && mirror.verdict === "BEHIND LUCK ON THIS HISTORY");
check("doing nothing scores exactly 0 and sits in the band", flatC.total === 0 && flatC.verdict === "INSIDE THE LUCK BAND");
const meanDecoy = board.band.p50[board.band.p50.length - 1];
check("the decoy median ends below zero by roughly the cost, not far away", meanDecoy < 0.5 && meanDecoy > -3, `(median ${meanDecoy.toFixed(2)})`);
check("the band is ordered p5 <= p50 <= p95 on every day", board.band.p5.every((v, i) => v <= board.band.p50[i] && board.band.p50[i] <= board.band.p95[i]));
// an AI contestant that joined late is judged only over its own days
const late = buildArena(synth, [{ id: "late", label: "joined at day 30", kind: "ai", positionOf: () => 1, activeDays: new Set(synth.map((s) => s.dayKey).filter((k) => k >= "2026-03-30")) }]);
check("a late joiner is scored on its own days only", late.contestants[0].days <= 16 && late.contestants[0].rankPct === null && late.contestants[0].verdict === "COLLECTING" && late.contestants[0].cum.slice(0, 20).every((v) => v === null));

// ---- AI answer parser --------------------------------------------------------------------------------------------------------
const syms = ["EURUSD", "XAUUSD", "US30"];
const good = parseDecisions('```json\n{"decisions":[{"symbol":"EURUSD","position":1,"reason":"trend up"},{"symbol":"XAUUSD","position":-1,"reason":"x"}]}\n```', syms);
check("parser: fenced JSON, a missing market is flat", good !== null && good.decisions.length === 3 && good.missing.join() === "US30" && good.decisions.find((d) => d.symbol === "US30")?.position === 0 && good.decisions.find((d) => d.symbol === "XAUUSD")?.position === -1);
const messy = parseDecisions('Sure! {"decisions":[{"symbol":"EURUSD","position":5},{"symbol":"EURUSD","position":-1},{"symbol":"BTCUSD","position":1},{"symbol":"US30","position":"1","reason":"' + "y".repeat(300) + '"}]}', syms);
check("parser: a position outside -1, 0, 1 is flat; a duplicate or unknown market is ignored; the reason is cut", messy !== null && messy.decisions.find((d) => d.symbol === "EURUSD")?.position === 0 && messy.ignored === 2 && messy.decisions.find((d) => d.symbol === "US30")?.position === 1 && (messy.decisions.find((d) => d.symbol === "US30")?.reason?.length ?? 0) === 160);
check("parser: text without JSON or without the list gives null", parseDecisions("I cannot do that", syms) === null && parseDecisions('{"foo":1}', syms) === null && parseDecisions("{bad json}", syms) === null);
const pm: PromptMarket = { symbol: "EURUSD", label: "Euro / US dollar", price: 1.1, atrPct: 0.5, alignment: "aligned up", features: { w1: "up", d1: "up", h4: "mixed", resistance: { pct: 0.4, atr: 0.8 }, support: null, rangePos: 71 } };
const prompt = buildUserPrompt("2026-11-17T14:00:00Z", [pm]);
check("prompt carries the market facts and no outcome", prompt.includes("EURUSD") && prompt.includes("resistance +0.40% (0.80 ATR)") && prompt.includes("support none") && prompt.includes("71% of the 50-day range") && prompt.includes("2026-11-17T14:00:00Z"));

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
