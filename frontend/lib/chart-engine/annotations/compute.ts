// lib/chart-engine/annotations/compute.ts
// Pure market-structure annotation engine for the native chart (Professional Mode, 2026-11-19).
// Input: candles (oldest -> newest). Output: descriptive annotations. No prediction, no I/O, no randomness.
// Rules (all deterministic, documented so every drawn item can be re-checked by hand):
//  - Swing high/low: fractal with `swingBars` (k) candles each side; confirmed k bars later (no look-ahead).
//  - BOS / CHoCH: a CLOSE beyond the last confirmed swing. Same direction as the running trend = BOS,
//    opposite direction = CHoCH. Each swing can be broken once.
//  - Order block: last opposite-colour candle before the leg that broke structure. Ends when a close goes
//    through it; a violated OB is shown once as a Breaker of the opposite bias.
//  - FVG: 3-candle gap (low[i] > high[i-2] or high[i] < low[i-2]) of at least 0.3 ATR; ends when price trades back into it fully.
//  - Sweep: wick beyond the last confirmed swing with the close back on the original side.
//  - Premium / discount / OTE: from the last confirmed swing high and low (50 % line; OTE = 61.8-78.6 % retracement).
//  - S/R: swing prices clustered within 0.5 ATR; shown when touched 2+ times.
//  - Double top / bottom: two swing extremes within 0.25 ATR, 5+ bars apart, neckline = extreme between them.
//  - Sessions: London / New York 08:00 local-time open (DST aware via Intl).

import type { ChartCandle } from "@/types/chart-data";
import type { AnnotationCounts, AnnotationResult, ChartAnnotation, ZoneAnnotation } from "./types";

export interface ComputeOptions {
  swingBars?: number;
  /** Only the last N candles are analysed (keeps it fast and the chart readable). */
  maxBars?: number;
  /** Only structure, sweeps, patterns and imbalance/order-block zones that formed within the last N candles are kept (default 120, the plan lookback), so the chart stays readable. */
  recentBars?: number;
}

interface Swing { index: number; time: number; price: number; broken: boolean }

const MAX_OB = 2;
const MAX_FVG = 2;
const MAX_STRUCTURE = 2;
const MAX_SWEEPS = 1;
const MAX_SESSIONS = 2;

export function atr14(c: ChartCandle[], end = c.length - 1, n = 14): number {
  const from = Math.max(1, end - n + 1);
  let s = 0, k = 0;
  for (let i = from; i <= end; i++) {
    const tr = Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close));
    s += tr; k++;
  }
  return k > 0 ? s / k : 0;
}

export function computeAnnotations(all: ChartCandle[], opts: ComputeOptions = {}): AnnotationResult {
  const k = opts.swingBars ?? 3;
  const maxBars = opts.maxBars ?? 500;
  const c = all.length > maxBars ? all.slice(all.length - maxBars) : all;
  const out: ChartAnnotation[] = [];
  const empty = (): AnnotationResult => ({ annotations: [], counts: countOf([]), params: { swingBars: k, atr: 0 } });
  if (c.length < 2 * k + 5) return empty();
  const atr = atr14(c);
  if (!(atr > 0)) return empty();
  const T = (i: number) => c[i].time;

  let lastHigh: Swing | null = null;
  let lastLow: Swing | null = null;
  const highs: Swing[] = [];
  const lows: Swing[] = [];
  let trend: "bullish" | "bearish" | null = null;
  let id = 0;
  const obs: { z: ZoneAnnotation; idx: number }[] = [];

  for (let i = 0; i < c.length; i++) {
    // confirm the swing at i-k (needs k bars on each side)
    const p = i - k;
    if (p >= k) {
      let isH = true, isL = true;
      for (let j = p - k; j <= p + k; j++) {
        if (j === p) continue;
        if (c[j].high > c[p].high || (j < p && c[j].high === c[p].high)) isH = false;
        if (c[j].low < c[p].low || (j < p && c[j].low === c[p].low)) isL = false;
      }
      if (isH) { lastHigh = { index: p, time: T(p), price: c[p].high, broken: false }; highs.push(lastHigh); }
      if (isL) { lastLow = { index: p, time: T(p), price: c[p].low, broken: false }; lows.push(lastLow); }
    }

    // liquidity sweep (wick beyond swing, close back inside) - only when the swing is still unbroken
    if (lastHigh && !lastHigh.broken && c[i].high > lastHigh.price && c[i].close < lastHigh.price && i > lastHigh.index) {
      out.push({ id: `sw${id++}`, type: "marker", group: "structure", kind: "sweep", bias: "bearish", time: T(i), price: c[i].high, label: "Sweep" });
    }
    if (lastLow && !lastLow.broken && c[i].low < lastLow.price && c[i].close > lastLow.price && i > lastLow.index) {
      out.push({ id: `sw${id++}`, type: "marker", group: "structure", kind: "sweep", bias: "bullish", time: T(i), price: c[i].low, label: "Sweep" });
    }

    // structure break by close
    if (lastHigh && !lastHigh.broken && c[i].close > lastHigh.price && i > lastHigh.index) {
      const kind = trend === "bearish" ? "CHoCH" : "BOS";
      lastHigh.broken = true; trend = "bullish";
      out.push({ id: `st${id++}`, type: "structure", group: "structure", kind, bias: "bullish", fromTime: lastHigh.time, toTime: T(i), price: lastHigh.price, label: kind });
      // bullish order block: last bearish candle before the break, searched back to the last swing low
      const stop = lastLow ? lastLow.index : Math.max(0, i - 30);
      for (let j = i - 1; j >= stop; j--) {
        if (c[j].close < c[j].open) {
          obs.push({ idx: i, z: { id: `ob${id++}`, type: "zone", group: "zones", kind: "orderBlock", bias: "bullish", startTime: T(j), endTime: null, low: c[j].low, high: c[j].high, label: "Demand OB" } });
          break;
        }
      }
    } else if (lastLow && !lastLow.broken && c[i].close < lastLow.price && i > lastLow.index) {
      const kind = trend === "bullish" ? "CHoCH" : "BOS";
      lastLow.broken = true; trend = "bearish";
      out.push({ id: `st${id++}`, type: "structure", group: "structure", kind, bias: "bearish", fromTime: lastLow.time, toTime: T(i), price: lastLow.price, label: kind });
      const stop = lastHigh ? lastHigh.index : Math.max(0, i - 30);
      for (let j = i - 1; j >= stop; j--) {
        if (c[j].close > c[j].open) {
          obs.push({ idx: i, z: { id: `ob${id++}`, type: "zone", group: "zones", kind: "orderBlock", bias: "bearish", startTime: T(j), endTime: null, low: c[j].low, high: c[j].high, label: "Supply OB" } });
          break;
        }
      }
    }
  }

  // order blocks: end on a close through them; show a violated one once as a breaker
  const obZones: ZoneAnnotation[] = [];
  for (const o of obs) {
    const z = o.z;
    let endIdx = -1;
    for (let j = o.idx + 1; j < c.length; j++) {
      if ((z.bias === "bullish" && c[j].close < z.low) || (z.bias === "bearish" && c[j].close > z.high)) { endIdx = j; break; }
    }
    if (endIdx < 0) obZones.push(z);
    else {
      obZones.push({ ...z, endTime: T(endIdx) }); // a violated order block simply ends (breakers are not drawn: they only added clutter)
    }
  }
  const active = obZones.filter((z) => z.endTime === null);
  const keepIds = new Set(active.slice(-MAX_OB).map((z) => z.id));
  for (const z of obZones) if (z.endTime !== null || keepIds.has(z.id)) { if (z.endTime === null || keepIds.has(z.id)) out.push(z); }
  // ended OBs are history clutter: drop the ones that ended (keep breakers which are active)
  for (let i = out.length - 1; i >= 0; i--) { const a = out[i]; if (a.type === "zone" && a.kind === "orderBlock" && a.endTime !== null) out.splice(i, 1); }

  // fair value gaps
  const fvgs: ZoneAnnotation[] = [];
  for (let i = 2; i < c.length; i++) {
    const minGap = 0.3 * atr;
    if (c[i].low - c[i - 2].high >= minGap) {
      fvgs.push({ id: `fv${id++}`, type: "zone", group: "zones", kind: "fvg", bias: "bullish", startTime: T(i - 1), endTime: null, low: c[i - 2].high, high: c[i].low, label: "FVG" });
    } else if (c[i - 2].low - c[i].high >= minGap) {
      fvgs.push({ id: `fv${id++}`, type: "zone", group: "zones", kind: "fvg", bias: "bearish", startTime: T(i - 1), endTime: null, low: c[i].high, high: c[i - 2].low, label: "FVG" });
    } else continue;
    const z = fvgs[fvgs.length - 1];
    for (let j = i + 1; j < c.length; j++) {
      if ((z.bias === "bullish" && c[j].low <= z.low) || (z.bias === "bearish" && c[j].high >= z.high)) { z.endTime = T(j); break; }
    }
  }
  for (const z of fvgs.filter((f) => f.endTime === null).slice(-MAX_FVG)) out.push(z);

  // premium / discount / OTE from the last confirmed swing range
  if (lastHigh && lastLow) {
    // The dealing range follows the leg that made the latest structure break: after a bullish break it runs from the last swing low up to the
    // highest high since (the running extreme, even if not yet confirmed as a swing); after a bearish break, from the last swing high down to
    // the lowest low since. So the OTE retraces the impulse that matches the bias. With no break yet, the last two confirmed swings are used.
    let hi = lastHigh.price, lo = lastLow.price;
    let legUpOverride: boolean | null = null;
    if (trend === "bullish") {
      hi = Math.max(lastHigh.price, ...c.slice(lastLow.index).map((x) => x.high));
      legUpOverride = true;
    } else if (trend === "bearish") {
      lo = Math.min(lastLow.price, ...c.slice(lastHigh.index).map((x) => x.low));
      legUpOverride = false;
    }
    const r = hi - lo;
    if (r > 0) {
      const start = Math.min(lastHigh.time, lastLow.time);
      const mid = lo + r / 2;
      out.push({ id: `pd${id++}`, type: "zone", group: "pdOte", kind: "premium", bias: null, startTime: start, endTime: null, low: mid, high: hi, label: "Premium" });
      out.push({ id: `pd${id++}`, type: "zone", group: "pdOte", kind: "discount", bias: null, startTime: start, endTime: null, low: lo, high: mid, label: "Discount" });
      const legUp = legUpOverride ?? lastHigh.index > lastLow.index;
      out.push(legUp
        ? { id: `ot${id++}`, type: "zone", group: "pdOte", kind: "ote", bias: "bullish", startTime: start, endTime: null, low: hi - 0.786 * r, high: hi - 0.618 * r, label: "OTE" }
        : { id: `ot${id++}`, type: "zone", group: "pdOte", kind: "ote", bias: "bearish", startTime: start, endTime: null, low: lo + 0.618 * r, high: lo + 0.786 * r, label: "OTE" });
    }
  }

  // S/R clusters from swing prices
  const pts = [...highs, ...lows].sort((a, b) => a.price - b.price);
  const clusters: { sum: number; n: number; first: number }[] = [];
  for (const s of pts) {
    const cl = clusters[clusters.length - 1];
    if (cl && Math.abs(s.price - cl.sum / cl.n) <= 0.5 * atr) { cl.sum += s.price; cl.n++; cl.first = Math.min(cl.first, s.time); }
    else clusters.push({ sum: s.price, n: 1, first: s.time });
  }
  const last = c[c.length - 1].close;
  clusters.filter((x) => x.n >= 2)
    .sort((a, b) => Math.abs(a.sum / a.n - last) - Math.abs(b.sum / b.n - last)).slice(0, 3)
    .forEach((x) => out.push({ id: `sr${id++}`, type: "level", group: "levels", price: x.sum / x.n, touches: x.n, startTime: x.first, label: `S/R ×${x.n}` }));

  // double top / bottom (most recent pair)
  const dtol = 0.25 * atr;
  for (let a = highs.length - 1; a >= 1; a--) {
    const h2 = highs[a], h1 = highs[a - 1];
    if (h2.index - h1.index < 5 || Math.abs(h2.price - h1.price) > dtol) continue;
    let neck = Infinity;
    for (let j = h1.index; j <= h2.index; j++) neck = Math.min(neck, c[j].low);
    out.push({ id: `pt${id++}`, type: "pattern", group: "patterns", kind: "doubleTop", t1: h1.time, t2: h2.time, price1: h1.price, price2: h2.price, neckline: neck, label: "Double Top" });
    break;
  }
  for (let a = lows.length - 1; a >= 1; a--) {
    const l2 = lows[a], l1 = lows[a - 1];
    if (l2.index - l1.index < 5 || Math.abs(l2.price - l1.price) > dtol) continue;
    let neck = -Infinity;
    for (let j = l1.index; j <= l2.index; j++) neck = Math.max(neck, c[j].high);
    out.push({ id: `pt${id++}`, type: "pattern", group: "patterns", kind: "doubleBottom", t1: l1.time, t2: l2.time, price1: l1.price, price2: l2.price, neckline: neck, label: "Double Bottom" });
    break;
  }

  // sessions (intraday only)
  const step = c.length > 1 ? T(c.length - 1) - T(c.length - 2) : 0;
  if (step > 0 && step <= 4 * 3600_000) {
    for (const [session, tz] of [["LDN", "Europe/London"], ["NY", "America/New_York"]] as const) {
      const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false, day: "2-digit", month: "2-digit", year: "numeric" });
      let lastDay = "";
      const found: ChartAnnotation[] = [];
      for (let i = 0; i < c.length; i++) {
        const parts = fmt.formatToParts(new Date(T(i)));
        const g = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
        const day = `${g("year")}-${g("month")}-${g("day")}`;
        if (Number(g("hour")) >= 8 && day !== lastDay) {
          lastDay = day;
          found.push({ id: `se${id++}`, type: "session", group: "sessions", session, time: T(i), label: session });
        }
      }
      out.push(...found);
    }
  }

  // Declutter (Pipflow-style): keep only the most recent / relevant items of each kind so the chart stays readable.
  const keep = new Set<string>();
  const newest = <T extends ChartAnnotation>(items: T[], n: number, time: (x: T) => number) => [...items].sort((a, b) => time(b) - time(a)).slice(0, n).forEach((x) => keep.add(x.id));
  newest(out.filter((a): a is Extract<ChartAnnotation, { type: "structure" }> => a.type === "structure"), MAX_STRUCTURE, (x) => x.toTime);
  newest(out.filter((a): a is Extract<ChartAnnotation, { type: "marker" }> => a.type === "marker"), MAX_SWEEPS, (x) => x.time);
  newest(out.filter((a): a is Extract<ChartAnnotation, { type: "pattern" }> => a.type === "pattern"), 1, (x) => x.t2);
  for (const sess of ["LDN", "NY"] as const) newest(out.filter((a): a is Extract<ChartAnnotation, { type: "session" }> => a.type === "session" && a.session === sess), MAX_SESSIONS, (x) => x.time);
  const recent = opts.recentBars ?? 120;
  const cutoff = c[Math.max(0, c.length - recent)].time;
  const final = out.filter((a) => {
    if (a.type === "structure") return keep.has(a.id) && a.toTime >= cutoff;
    if (a.type === "marker") return keep.has(a.id) && a.time >= cutoff;
    if (a.type === "pattern") return keep.has(a.id) && a.t2 >= cutoff;
    if (a.type === "session") return keep.has(a.id);
    if (a.type === "zone" && (a.kind === "orderBlock" || a.kind === "breaker" || a.kind === "fvg")) return a.startTime >= cutoff;
    return true;
  });

  return { annotations: final, counts: countOf(final), params: { swingBars: k, atr } };
}

export function countOf(a: ChartAnnotation[]): AnnotationCounts {
  const n = (f: (x: ChartAnnotation) => boolean) => a.filter(f).length;
  return {
    total: a.length,
    lines: n((x) => x.type === "structure"),
    zones: n((x) => x.type === "zone"),
    markers: n((x) => x.type === "marker"),
    levels: n((x) => x.type === "level"),
    patterns: n((x) => x.type === "pattern"),
    sessions: n((x) => x.type === "session"),
  };
}
