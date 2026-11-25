// scripts/rnd-plan-variants.ts - R&D: how does the Pro Chart plan rule score on real Exness history, and which filters (the ones other SMC tools use) help,
// measured out of sample? Not a product feature: a research tool. Every number is measured on past candles, before spread and commission.
// Run: DIR=E:/at24-mt4-build/rnd npx tsx scripts/rnd-plan-variants.ts
import { readFileSync } from "node:fs";
import { planAt, PLAN_FILL_WINDOW, PLAN_MAX_HOLD, type TradePlan } from "../lib/chart-engine/annotations/plan";
import { computeAnnotations } from "../lib/chart-engine/annotations/compute";
import { ema } from "../lib/chart-engine/annotations/readout";
import { resolveOutcome } from "../lib/chart-engine/signals/outcome";
import type { ChartCandle } from "../types/chart-data";

const DIR = process.env.DIR ?? "E:/at24-mt4-build/rnd";
const SYMBOLS = (process.env.SYMBOLS ?? "XAUUSD,EURUSD,GBPUSD,BTCUSD,USOIL").split(",");
const WINDOW = 200;
const STEP = 1;

function load(file: string): ChartCandle[] {
  const lines = readFileSync(`${DIR}/${file}`, "utf8").trim().split(/\r?\n/).slice(1);
  const out: ChartCandle[] = [];
  for (const l of lines) {
    const [ts, o, h, lo, c, v] = l.split(",");
    out.push({ time: Date.parse(ts), open: +o, high: +h, low: +lo, close: +c, volume: +v });
  }
  return out.sort((a, b) => a.time - b.time);
}

type Plan = Extract<TradePlan, { state: "plan" }>;
interface Ctx { i: number; hourUtc: number; htfBias: "bullish" | "bearish" | null }
interface Variant { name: string; accept: (p: Plan, c: Ctx) => boolean; rr?: number; /** target at the EMA50 (mean reversion, as the reference chart does) when it gives R:R between 1 and 3; "only" skips the plan when it does not */ ema50Target?: "or2R" | "only" }

const hasConf = (p: Plan, s: string) => p.confluences.some((x) => x.includes(s));
const VARIANTS: Variant[] = [
  { name: "A baseline (score>=3, RR 2)", accept: () => true },
  { name: "B higher-timeframe bias agrees", accept: (p, c) => c.htfBias !== null && (p.dir === "long") === (c.htfBias === "bullish") },
  { name: "C London+NY hours only (07-17 UTC)", accept: (_p, c) => c.hourUtc >= 7 && c.hourUtc < 17 },
  { name: "D needs a liquidity sweep", accept: (p) => hasConf(p, "Liquidity sweep") },
  { name: "E needs EMA trend aligned", accept: (p) => hasConf(p, "EMA20") },
  { name: "F score>=4", accept: (p) => p.score >= 4 },
  { name: "G score>=5", accept: (p) => p.score >= 5 },
  { name: "H market entries only (price inside the zone)", accept: (p) => p.entryType === "market" },
  { name: "I limit entries only", accept: (p) => p.entryType === "limit" },
  { name: "J HTF agrees + sweep", accept: (p, c) => c.htfBias !== null && (p.dir === "long") === (c.htfBias === "bullish") && hasConf(p, "Liquidity sweep") },
  { name: "K HTF agrees + London/NY + score>=4", accept: (p, c) => c.htfBias !== null && (p.dir === "long") === (c.htfBias === "bullish") && c.hourUtc >= 7 && c.hourUtc < 17 && p.score >= 4 },
  { name: "L baseline, RR 1.5", accept: () => true, rr: 1.5 },
  { name: "M baseline, RR 3", accept: () => true, rr: 3 },
  { name: "N target = EMA50 when R:R 1-3, else 2R", accept: () => true, ema50Target: "or2R" },
  { name: "O target = EMA50 only (skip when not usable)", accept: () => true, ema50Target: "only" },
  { name: "P EMA50 target + EMA aligned", accept: (p) => hasConf(p, "EMA20"), ema50Target: "only" },
];

interface Trade { symbol: string; time: number; r: number; status: string }

function htfBiasAt(h4: ChartCandle[], timeMs: number): "bullish" | "bearish" | null {
  // only 4h candles that were already CLOSED at this time (their open time + 4h <= timeMs)
  let hi = -1;
  for (let k = h4.length - 1; k >= 0; k--) if (h4[k].time + 4 * 3_600_000 <= timeMs) { hi = k; break; }
  if (hi < 60) return null;
  const win = h4.slice(Math.max(0, hi - 199), hi + 1);
  const res = computeAnnotations(win);
  const brks = res.annotations.filter((a) => a.type === "structure");
  const last = brks.sort((a, b) => (a.type === "structure" && b.type === "structure" ? a.toTime - b.toTime : 0))[brks.length - 1];
  return last && last.type === "structure" ? last.bias : null;
}

function run(symbol: string, h1: ChartCandle[], h4: ChartCandle[], v: Variant): Trade[] {
  const trades: Trade[] = [];
  let i = WINDOW;
  // the higher-timeframe bias changes slowly: cached per 4h bucket
  const htfCache = new Map<number, "bullish" | "bearish" | null>();
  const htfAt = (t: number) => { const key = Math.floor(t / (4 * 3_600_000)); if (!htfCache.has(key)) htfCache.set(key, htfBiasAt(h4, t)); return htfCache.get(key) ?? null; };
  while (i < h1.length - 2) {
    const win = h1.slice(i - WINDOW + 1, i + 1);
    const p = planAt(win);
    if (p.state !== "plan") { i += STEP; continue; }
    const ctx: Ctx = { i, hourUtc: new Date(h1[i].time).getUTCHours(), htfBias: v.name.startsWith("B") || v.name.startsWith("J") || v.name.startsWith("K") ? htfAt(h1[i].time + 3_600_000) : null };
    if (!v.accept(p, ctx)) { i += STEP; continue; }
    let rr = v.rr ?? p.rr;
    const risk = Math.abs(p.entry - p.stop);
    let target = p.dir === "long" ? p.entry + rr * risk : p.entry - rr * risk;
    if (v.ema50Target) {
      const e50 = ema(win.map((c) => c.close), 50);
      const reward = e50 === null ? NaN : p.dir === "long" ? e50 - p.entry : p.entry - e50;
      const usable = e50 !== null && reward / risk >= 1 && reward / risk <= 3;
      if (usable) { target = e50 as number; rr = reward / risk; }
      else if (v.ema50Target === "only") { i += STEP; continue; }
    }
    const future = h1.slice(i + 1, i + 1 + PLAN_FILL_WINDOW + PLAN_MAX_HOLD + 5);
    const o = resolveOutcome({ dir: p.dir, entryType: p.entryType, entry: p.entry, stop: p.stop, target, rr, signalTime: h1[i].time }, future);
    if (o.status === "open" || o.status === "live") break; // not resolved yet: the end of the data
    if (o.status === "target" || o.status === "stop" || o.status === "expired") trades.push({ symbol, time: h1[i].time, r: o.resultR ?? 0, status: o.status });
    // no overlapping trades: continue after this one is over (or after the fill window for a signal that never filled)
    const closedAt = o.closedAt ?? (future[Math.min(future.length - 1, PLAN_FILL_WINDOW - 1)]?.time ?? h1[i].time);
    const next = h1.findIndex((c, k) => k > i && c.time >= closedAt);
    i = next < 0 ? h1.length : Math.max(i + 1, next);
  }
  return trades;
}

function stats(ts: Trade[]) {
  const n = ts.length;
  const finished = ts.filter((t) => t.status === "target" || t.status === "stop");
  const wins = finished.filter((t) => t.status === "target").length;
  const sumR = ts.reduce((a, t) => a + t.r, 0);
  const avg = n ? sumR / n : 0;
  const sd = n > 1 ? Math.sqrt(ts.reduce((a, t) => a + (t.r - avg) ** 2, 0) / (n - 1)) : 0;
  return { n, targetShare: finished.length ? wins / finished.length : 0, avgR: avg, se: n > 1 ? sd / Math.sqrt(n) : 0, sumR };
}

const data = SYMBOLS.map((s) => ({ s, h1: load(`${s}_1h.csv`), h4: load(`${s}_4h.csv`) }));
console.log(`symbols: ${SYMBOLS.join(", ")} | window ${WINDOW} bars | stop first, no spread/commission | out-of-sample = the last 40% of each symbol's time span\n`);
const header = "variant".padEnd(48) + "ALL n".padStart(7) + " avgR(se)".padStart(15) + " hit%".padStart(6) + " | OOS n".padStart(8) + " avgR(se)".padStart(15) + " hit%".padStart(6);
console.log(header);
const ONLY = (process.env.ONLY ?? "").split(",").filter(Boolean);
for (const v of VARIANTS) {
  if (ONLY.length > 0 && !ONLY.includes(v.name[0])) continue;
  const all: Trade[] = [];
  const oos: Trade[] = [];
  for (const d of data) {
    const t = run(d.s, d.h1, d.h4, v);
    const cut = d.h1[Math.floor(d.h1.length * 0.6)].time;
    all.push(...t);
    oos.push(...t.filter((x) => x.time >= cut));
  }
  const a = stats(all), o = stats(oos);
  const f = (s: ReturnType<typeof stats>) => `${s.avgR >= 0 ? "+" : ""}${s.avgR.toFixed(2)}(${s.se.toFixed(2)})`;
  console.log(v.name.padEnd(48) + String(a.n).padStart(7) + f(a).padStart(15) + (a.targetShare * 100).toFixed(0).padStart(6) + " |" + String(o.n).padStart(7) + f(o).padStart(15) + (o.targetShare * 100).toFixed(0).padStart(6));
}
