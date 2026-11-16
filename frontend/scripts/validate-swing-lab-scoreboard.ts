// scripts/validate-swing-lab-scoreboard.ts
// Validation for the Swing Lab forward scoreboard maths (no network, no database): hand-worked cases for the market-open rule,
// the forward close (including weekends and data gaps), the signed continuation score, de-duplication and the board totals.
import type { Bar } from "../services/swing-lab/compute";
import { BAR_4H_MS, DEDUPE_MS, FORWARD_MS, buildSwingBoard, dedupeSwingEvents, forwardClose, marketOpen, scoreSnapshot, type DoneSnapshot } from "../services/swing-lab/scoreboard";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!ok) failures += 1;
}
const near = (a: number, b: number, tol = 1e-9): boolean => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const H = 3_600_000;
const DAY = 24 * H;
const bar = (t: number, close: number): Bar => ({ t, open: close, high: close, low: close, close });

// ---- market open -------------------------------------------------------------------------------------------------------
check("market open: a bar up to 8 hours old counts", marketOpen(0, 8 * H) && !marketOpen(0, 8 * H + 1));

// ---- forward close -----------------------------------------------------------------------------------------------------
const bars: Bar[] = Array.from({ length: 60 }, (_, i) => bar(i * BAR_4H_MS, 100 + i)); // bar i closes at (i + 1) * 4 h with close 100 + i
check("forward close: the bar closing exactly at the target is used", forwardClose(bars, 10 * BAR_4H_MS) === 109); // bar 9 closes at 10 * 4 h
check("forward close: a target inside a bar uses the previous closed bar", forwardClose(bars, 10 * BAR_4H_MS + 1 * H) === 109);
check("forward close: a target before any bar closed gives null", forwardClose(bars, 2 * H) === null);
// weekend: bars stop at index 29 (closes at 30 * 4 h = 120 h); the target is 150 h => last close is 30 h older, below the 72 h limit => used
const gap = bars.slice(0, 30);
check("forward close: a weekend target uses the last close before it", forwardClose(gap, 150 * H) === 129);
check("forward close: a gap of more than 72 hours drops the snapshot", forwardClose(gap, 120 * H + 73 * H) === null && forwardClose(gap, 120 * H + 72 * H) === 129);

// ---- score -------------------------------------------------------------------------------------------------------------
// price 100, ATR 2 %, forward 104 => raw = 4 % / 2 % = +2 ATR; aligned up keeps it, aligned down flips it, mixed has none
const up = scoreSnapshot({ alignment: "aligned up", price: 100, atrPct: 2 }, 104);
const dn = scoreSnapshot({ alignment: "aligned down", price: 100, atrPct: 2 }, 104);
const mx = scoreSnapshot({ alignment: "mixed", price: 100, atrPct: 2 }, 104);
check("score: aligned up continues when price rises", near(up.rawAtr, 2) && near(up.r ?? NaN, 2));
check("score: aligned down is penalised when price rises", near(dn.rawAtr, 2) && near(dn.r ?? NaN, -2));
check("score: mixed has a raw move but no signed score", near(mx.rawAtr, 2) && mx.r === null);
check("score: a fall below the entry is negative raw", near(scoreSnapshot({ alignment: "aligned down", price: 100, atrPct: 4 }, 92).r ?? NaN, 2));

// ---- de-duplication ----------------------------------------------------------------------------------------------------
const dd = dedupeSwingEvents([
  { symbol: "EURUSD", dir: "up", at: 0, r: 1 },
  { symbol: "EURUSD", dir: "up", at: 2 * DAY, r: 5 }, // inside 5 days of the kept one -> dropped
  { symbol: "EURUSD", dir: "up", at: DEDUPE_MS, r: 2 }, // exactly 5 days later -> kept
  { symbol: "EURUSD", dir: "down", at: 2 * DAY, r: 3 }, // other direction -> kept
  { symbol: "GBPUSD", dir: "up", at: 1 * DAY, r: 4 }, // other market -> kept
]);
check("dedupe keeps 4 of 5", dd.length === 4 && !dd.some((e) => e.r === 5));
check("forward horizon is 120 hours", FORWARD_MS === 120 * H);

// ---- board by hand -----------------------------------------------------------------------------------------------------
const snaps: DoneSnapshot[] = [
  { symbol: "EURUSD", alignment: "aligned up", at: 0, rawAtr: 1, r: 1 },
  { symbol: "EURUSD", alignment: "aligned up", at: 1 * DAY, rawAtr: 3, r: 3 }, // dropped by dedupe, still counts toward the drift
  { symbol: "EURUSD", alignment: "mixed", at: 2 * DAY, rawAtr: -1, r: null },
  { symbol: "XAUUSD", alignment: "aligned down", at: 0, rawAtr: -2, r: 2 },
  { symbol: "US30", alignment: "aligned up", at: 0, rawAtr: -3, r: -3 },
];
const board = buildSwingBoard(snaps, 7);
check("board: pooled up has 2 counted events (EURUSD 1 and US30 -3), mean -1", board.pooled.up.n === 2 && near(board.pooled.up.meanR ?? NaN, -1) && board.pooled.up.verdict === "COLLECTING");
check("board: pooled down has 1 event with r +2", board.pooled.down.n === 1 && near(board.pooled.down.meanR ?? NaN, 2));
check("board: drift is the mean raw move of all 5 snapshots", board.pooled.up.snapshots === 5 && near(board.pooled.up.driftAtr ?? NaN, (1 + 3 - 1 - 2 - 3) / 5));
check("board: open and done counts", board.open === 7 && board.done === 5);
const eur = board.rows.find((r) => r.symbol === "EURUSD");
check("board: a market row counts its own events and drift", !!eur && eur.up.n === 1 && eur.down.n === 0 && eur.up.snapshots === 3 && near(eur.up.driftAtr ?? NaN, (1 + 3 - 1) / 3));
const fx = board.groups.find((g) => g.group === "forex");
const idx = board.groups.find((g) => g.group === "indices");
check("board: groups", !!fx && fx.up.n === 1 && !!idx && idx.up.n === 1 && near(idx.up.meanR ?? NaN, -3) && !board.groups.some((g) => g.group === "energy"));

// ---- verdict only from 30 events: 40 events over 40 different markets-days, consistently positive ---------------------------------
const many: DoneSnapshot[] = Array.from({ length: 40 }, (_, i) => ({ symbol: `S${i}`, alignment: "aligned up" as const, at: 0, rawAtr: 1 + (i % 2 ? 0.1 : -0.1), r: 1 + (i % 2 ? 0.1 : -0.1) }));
check("board: 40 consistent events give a POSITIVE verdict (symbols outside the catalogue only enter the pooled and market rows)", buildSwingBoard(many, 0).pooled.up.verdict === "POSITIVE ON THIS HISTORY");

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
