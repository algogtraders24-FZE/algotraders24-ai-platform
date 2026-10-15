// R&D (not part of the product): how much too narrow is the ATR volatility band when a scheduled high-impact US release
// (CPI, Non-Farm Payrolls, FOMC decision) falls inside the forecast window, and can a fixed widening factor, fitted on
// 2023-2024, restore the stated 80% coverage on 2025-2026?
//
// Forecasts are issued at 4-hour slot starts (00, 04, 08 ... UTC) exactly like the live scoreboard; entry = next bar open;
// outcome = |close h hours later - entry|; band = ATR14(1h) * sqrt(h) * 0.9 (12h) / 0.95 (24h) (the shipped formula).
//
// Event dates: FOMC decision days from the Federal Reserve calendar (2023-2026); Non-Farm Payrolls = first Friday of the month
// with the three known exceptions; CPI dates as published by the BLS for 2023 to 2025 (recalled, then CHECKED here against the
// price data: every event must show a real volatility reaction at its release hour, otherwise it is reported and excluded).
// 2026 CPI dates are not known to this script and are left out. Release times: 08:30 ET (CPI, NFP), 14:00 ET (FOMC), converted
// to UTC with the US daylight-saving rules.
//
// usage: npx tsx scripts/research/event-vol.ts <ohlc.csv> <label>
import { readFileSync } from "node:fs";
import { atrSeries } from "../../services/smc/smc-engine";

const file = process.argv[2];
const label = process.argv[3] ?? file;
if (!file) throw new Error("csv path required");

// ---- events -------------------------------------------------------------
type Kind = "CPI" | "NFP" | "FOMC";
interface Ev { kind: Kind; date: string; tsMs: number }

/** UTC ms of a New York wall-clock time (handles DST). */
function nyToUtc(date: string, hh: number, mm: number): number {
  const guess = Date.parse(`${date}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`);
  for (const offsetH of [4, 5]) {
    const t = guess + offsetH * 3_600_000;
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(t));
    const get = (k: string) => parts.find((p) => p.type === k)!.value;
    if (Number(get("hour")) % 24 === hh && Number(get("minute")) === mm && `${get("year")}-${get("month")}-${get("day")}` === date) return t;
  }
  throw new Error("tz " + date);
}

const CPI = ["2023-01-12","2023-02-14","2023-03-14","2023-04-12","2023-05-10","2023-06-13","2023-07-12","2023-08-10","2023-09-13","2023-10-12","2023-11-14","2023-12-12",
  "2024-01-11","2024-02-13","2024-03-12","2024-04-10","2024-05-15","2024-06-12","2024-07-11","2024-08-14","2024-09-11","2024-10-10","2024-11-13","2024-12-11",
  "2025-01-15","2025-02-12","2025-03-12","2025-04-10","2025-05-13","2025-06-11","2025-07-15","2025-08-12","2025-09-11"];
const FOMC = ["2023-02-01","2023-03-22","2023-05-03","2023-06-14","2023-07-26","2023-09-20","2023-11-01","2023-12-13",
  "2024-01-31","2024-03-20","2024-05-01","2024-06-12","2024-07-31","2024-09-18","2024-11-07","2024-12-18",
  "2025-01-29","2025-03-19","2025-05-07","2025-06-18","2025-07-30","2025-09-17","2025-10-29","2025-12-10",
  "2026-01-28","2026-03-18","2026-04-29","2026-06-17","2026-07-29","2026-09-16"];
const NFP_EXCEPTIONS: Record<string, string> = { "2023-03": "2023-03-10", "2023-12": "2023-12-08", "2025-01": "2025-01-10", "2025-07": "2025-07-03" };
function firstFriday(y: number, m: number): string {
  for (let d = 1; d <= 7; d++) {
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCDay() === 5) return dt.toISOString().slice(0, 10);
  }
  throw new Error("no friday");
}
const events: Ev[] = [];
for (const d of CPI) events.push({ kind: "CPI", date: d, tsMs: nyToUtc(d, 8, 30) });
for (const d of FOMC) events.push({ kind: "FOMC", date: d, tsMs: nyToUtc(d, 14, 0) });
for (let y = 2023; y <= 2026; y++) for (let m = 1; m <= 12; m++) {
  if (y === 2026 && m > 9) continue;
  const key = `${y}-${String(m).padStart(2, "0")}`;
  if (key === "2025-10") continue; // the October 2025 release was cancelled / delayed (US government shutdown)
  const d = NFP_EXCEPTIONS[key] ?? firstFriday(y, m);
  events.push({ kind: "NFP", date: d, tsMs: nyToUtc(d, 8, 30) });
}
events.sort((a, b) => a.tsMs - b.tsMs);

// ---- prices -------------------------------------------------------------
interface Bar { t: number; open: number; high: number; low: number; close: number }
const bars: Bar[] = readFileSync(file, "utf8").trim().split(/\r?\n/).slice(1).map((r) => {
  const [t, o, h, l, c] = r.split(",");
  return { t: Date.parse(t.replace(" ", "T") + "Z"), open: +o, high: +h, low: +l, close: +c };
});
const idxByT = new Map(bars.map((b, i) => [b.t, i]));
const atr = atrSeries(bars.map((b) => ({ time: "", open: b.open, high: b.high, low: b.low, close: b.close })), 14);
const HOUR = 3_600_000;
const first = bars[0].t, last = bars[bars.length - 1].t;

// ---- event sanity check: does price react at the release hour? ------------
const trs = bars.map((b, i) => (i === 0 ? b.high - b.low : Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close))));
const reaction: { ev: Ev; ratio: number }[] = [];
const usable: Ev[] = [];
for (const ev of events) {
  if (ev.tsMs < first + 60 * HOUR || ev.tsMs > last - 30 * HOUR) continue;
  const i = idxByT.get(Math.floor(ev.tsMs / HOUR) * HOUR);
  if (i === undefined || !atr[i - 1]) continue;
  // the bar containing the release (and the next one, for 14:00 FOMC statement drift)
  const ratio = Math.max(trs[i], trs[i + 1] ?? 0) / (atr[i - 1] as number);
  reaction.push({ ev, ratio });
  usable.push(ev);
}
const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
console.log(`\n#### ${label}: ${usable.length} usable events (${events.length} listed)`);
for (const k of ["CPI", "NFP", "FOMC"] as Kind[]) {
  const r = reaction.filter((x) => x.ev.kind === k).map((x) => x.ratio);
  console.log(`  ${k}: n=${r.length}  median release-hour range = ${med(r).toFixed(2)} x ATR  (a normal bar is ~1.0)  share >1.5x: ${((r.filter((v) => v > 1.5).length / r.length) * 100).toFixed(0)}%`);
}
const suspicious = reaction.filter((x) => x.ratio < 0.9);
console.log(`  dates with NO reaction (<0.9x ATR) - possibly wrong date, still included but flagged: ${suspicious.map((x) => x.ev.kind + " " + x.ev.date).join(", ") || "none"}`);

// ---- forecasts at 4h slots ------------------------------------------------
type Cls = "none" | "pre0-3" | "pre3-12" | "post0-6";
interface F { i: number; t: number; h: 12 | 24; atr: number; ratio: number; cls: Cls; evId: number | null; kind: Kind | null; oos: boolean; block: number }
const MULT: Record<12 | 24, number> = { 12: 0.9, 24: 0.95 };
const forecasts: F[] = [];
for (let i = 60; i < bars.length - 26; i++) {
  if (new Date(bars[i].t).getUTCHours() % 4 !== 0) continue; // slot starts
  const a = atr[i];
  if (!a) continue;
  const entryT = bars[i + 1].t; // next bar open
  for (const h of [12, 24] as const) {
    const j = i + h;
    if (!bars[j] || bars[j].t - bars[i].t > (h + 6) * HOUR) continue; // gap (weekend) -> skip
    const ratio = Math.abs(bars[j].close - bars[i + 1].open) / (a * Math.sqrt(h) * MULT[h]); // <=1 means inside the shipped band
    let cls: Cls = "none";
    let evId: number | null = null;
    let kind: Kind | null = null;
    for (let k = 0; k < usable.length; k++) {
      const e = usable[k];
      const lead = (e.tsMs - entryT) / HOUR;
      if (lead >= 0 && lead <= h) { cls = lead <= 3 ? "pre0-3" : "pre3-12"; evId = k; kind = e.kind; break; }
      if (lead < 0 && lead >= -6) { cls = "post0-6"; evId = k; kind = e.kind; }
    }
    // a window with a pre-event takes priority over post-event; treat the h=24 window with an event after hour 12 as pre3-12
    forecasts.push({ i, t: bars[i].t, h, atr: a, ratio, cls, evId, kind, oos: bars[i].t >= Date.parse("2025-01-01T00:00:00Z"), block: Math.floor(bars[i].t / (7 * 24 * HOUR)) });
  }
}

const cover = (xs: F[], mult = 1) => xs.filter((f) => f.ratio <= mult).length / (xs.length || 1);
function clusterCI(xs: F[], mult = 1, reps = 600): [number, number] {
  if (xs.length < 8) return [NaN, NaN];
  const groups = new Map<string, F[]>();
  for (const f of xs) { const k = f.evId !== null ? "e" + f.evId : "b" + f.block; (groups.get(k) ?? groups.set(k, []).get(k)!).push(f); }
  const arr = [...groups.values()];
  let seed = 99;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const out: number[] = [];
  for (let r = 0; r < reps; r++) {
    let n = 0, k = 0;
    for (let g = 0; g < arr.length; g++) { const grp = arr[Math.floor(rnd() * arr.length)]; for (const f of grp) { n++; if (f.ratio <= mult) k++; } }
    out.push(k / n);
  }
  out.sort((a, b) => a - b);
  return [out[Math.floor(reps * 0.025)], out[Math.floor(reps * 0.975)]];
}
const pct = (v: number) => (v * 100).toFixed(0) + "%";
const q80 = (xs: F[]) => [...xs].map((f) => f.ratio).sort((a, b) => a - b)[Math.floor(0.8 * xs.length)];

for (const h of [12, 24] as const) {
  console.log(`\n== horizon ${h}h : coverage of the SHIPPED 80% band (target 80%)`);
  const hs = forecasts.filter((f) => f.h === h);
  for (const cls of ["none", "pre0-3", "pre3-12", "post0-6"] as Cls[]) {
    const xs = hs.filter((f) => f.cls === cls);
    const isx = xs.filter((f) => !f.oos), oox = xs.filter((f) => f.oos);
    const [lo, hi] = clusterCI(xs);
    console.log(`  ${cls.padEnd(8)} n=${String(xs.length).padStart(4)} events=${new Set(xs.map((f) => f.evId).filter((v) => v !== null)).size}  ALL ${pct(cover(xs))} CI[${pct(lo)}, ${pct(hi)}]   IS ${pct(cover(isx))} (n=${isx.length})   OOS ${pct(cover(oox))} (n=${oox.length})`);
  }
  console.log("  pre-event windows by kind (ALL):");
  for (const k of ["CPI", "NFP", "FOMC"] as Kind[]) {
    const xs = hs.filter((f) => f.kind === k && (f.cls === "pre0-3" || f.cls === "pre3-12"));
    console.log(`    ${k.padEnd(5)} n=${String(xs.length).padStart(3)}  coverage ${pct(cover(xs))}`);
  }
  // fit: widening factor for pre-event windows, from the in-sample 80% quantile of the miss ratio, then test out-of-sample
  for (const cls of ["pre0-3", "pre3-12"] as Cls[]) {
    const isx = hs.filter((f) => f.cls === cls && !f.oos);
    const oox = hs.filter((f) => f.cls === cls && f.oos);
    if (isx.length < 10 || oox.length < 5) { console.log(`  ${cls}: too few windows to fit (IS ${isx.length}, OOS ${oox.length})`); continue; }
    const m = Math.max(1, q80(isx));
    const [lo, hi] = clusterCI(oox, m);
    console.log(`  FIT ${cls}: widening factor fitted on 2023-24 = x${m.toFixed(2)};  OOS coverage unwidened ${pct(cover(oox))} -> widened ${pct(cover(oox, m))} CI[${pct(lo)}, ${pct(hi)}] (n=${oox.length}, events=${new Set(oox.map((f) => f.evId)).size})`);
  }
}

// coverage as a function of the widening factor for ALL pre-event windows (0-12h / 0-24h ahead), IS vs OOS
for (const h of [12, 24] as const) {
  const pre = forecasts.filter((f) => f.h === h && (f.cls === "pre0-3" || f.cls === "pre3-12"));
  console.log(`\n== ${label} ${h}h: coverage of pre-event windows vs widening factor (target 80%)  n=${pre.length} events=${new Set(pre.map((f) => f.evId)).size}`);
  for (const m of [1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 3]) {
    const isx = pre.filter((f) => !f.oos), oox = pre.filter((f) => f.oos);
    console.log(`  x${m.toFixed(2)}  ALL ${pct(cover(pre, m))}   IS ${pct(cover(isx, m))}   OOS ${pct(cover(oox, m))}`);
  }
}
