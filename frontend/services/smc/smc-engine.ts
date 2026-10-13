// services/smc/smc-engine.ts
// AT24 SMC structure engine - a deterministic TypeScript port of the owner's
// "AT24 SMC AI Engine" MQL5 indicator (swings, BOS/MSS, HTF bias, liquidity pools
// with sweep detection, order blocks, fair value gaps, premium/discount,
// volatility regime, structure score). PURE: no I/O, no clock, no LLM - the same
// candles always give the same analysis.
//
// What it is NOT: a trade signal. The indicator's BUY/SELL SETUP status and its
// entry/SL/TP are deliberately not ported (AT24 never issues trade instructions).
// What comes out is a structure lean (bullish-leaning / bearish-leaning / none) and
// the facts behind it. The score's weights are the owner's heuristic - not
// validated against outcomes - and every consumer labels it "rule-based structure,
// not a forecast".
//
// Differences from the MQL5 original (all fixes, listed in docs/architecture/SMC_ENGINE.md):
//  - swings are CONFIRMED L bars later and structure at bar t only uses swings
//    confirmed by t (no look-ahead); the indicator froze swing detection after its
//    first scan (ScanBar(1) can never satisfy i-L >= 0)
//  - sweeps are detected on every bar and timed by their own candle (the indicator
//    used TimeCurrent(), so history sweeps all looked fresh) and only on the latest
//    bar after the first run
//  - zones are mitigation-checked from the bar AFTER they form (a new FVG was
//    "tested" by its own candle) and expire by bar count, not wall-clock
//  - the score's denominator includes the MSS bonus (the raw score could pass 100)

export interface SmcCandle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface SmcParams {
  swingLength: number;
  htfSwingLength: number;
  sweepReclaimAtr: number;
  eqToleranceAtr: number;
  atrPeriod: number;
  obMitigationPct: number;
  fvgMitigationPct: number;
  zoneMaxAgeBars: number;
  sweepValidBars: number;
  scoreStrong: number;
  scoreDeveloping: number;
}

export const DEFAULT_SMC_PARAMS: SmcParams = {
  swingLength: 5,
  htfSwingLength: 5,
  sweepReclaimAtr: 0.5,
  eqToleranceAtr: 0.15,
  atrPeriod: 14,
  obMitigationPct: 50,
  fvgMitigationPct: 100,
  zoneMaxAgeBars: 100,
  sweepValidBars: 12,
  scoreStrong: 70,
  scoreDeveloping: 55,
};

export type SmcBias = "Bullish" | "Bearish" | "Neutral";
export type SmcEventKind = "BOS" | "MSS";
export type PoolKind = "EQH" | "EQL" | "PDH" | "PDL" | "PWH" | "PWL";
export type PoolStatus = "untouched" | "tested" | "swept";
export type ZoneStatus = "fresh" | "tested" | "mitigated";

export interface SmcEvent {
  kind: SmcEventKind;
  dir: "Bullish" | "Bearish";
  strong: boolean;
  /** Candle index (oldest-first, closed candles) of the closing break. */
  barIdx: number;
  level: number;
}

export interface LiquidityPool {
  kind: PoolKind;
  price: number;
  status: PoolStatus;
  formedIdx: number;
  sweptIdx?: number;
}

export interface SmcZone {
  kind: "OB" | "FVG";
  dir: 1 | -1;
  top: number;
  bot: number;
  /** Index of the candle the zone is anchored to. */
  anchorIdx: number;
  /** Index of the bar on which the zone became known (mitigation is only checked on later bars). */
  createdIdx: number;
  status: ZoneStatus;
}

export interface SmcScoreFactor {
  label: string;
  points: number;
  max: number;
}

export interface SmcAnalysis {
  /** Index of the last closed candle analysed. */
  lastClosedIdx: number;
  lastClosedTime: string;
  price: number;
  atr: number;
  bias: SmcBias;
  lastEvent: (SmcEvent & { barsAgo: number }) | null;
  /** The most recent structure events (up to 20), oldest first - audit trail and the no-look-ahead test. */
  eventLog: SmcEvent[];
  htf: { bias: SmcBias; event: string };
  sweep: { kind: PoolKind; barsAgo: number; fresh: boolean } | null;
  pools: LiquidityPool[];
  nearestPool: (LiquidityPool & { distance: number; side: "above" | "below" }) | null;
  ob: SmcZone | null;
  fvg: SmcZone | null;
  location: "Premium" | "Discount" | "Equilibrium" | "--";
  range: { high: number; low: number } | null;
  volatility: "High" | "Normal" | "Low" | "--";
  volatilityRatio: number | null;
  score: number;
  factors: SmcScoreFactor[];
  aligned: boolean;
  lean: "bullish-leaning" | "bearish-leaning" | "none";
  strength: "strong" | "developing" | "weak";
}

// ── indicators ──────────────────────────────────────────────────────────
/** ATR as a simple moving average of the true range (what MT5's iATR does). undefined until `period` bars exist. */
export function atrSeries(c: readonly SmcCandle[], period: number): (number | undefined)[] {
  const tr: number[] = c.map((k, i) => (i === 0 ? k.high - k.low : Math.max(k.high - k.low, Math.abs(k.high - c[i - 1].close), Math.abs(k.low - c[i - 1].close))));
  const out: (number | undefined)[] = [];
  let sum = 0;
  for (let i = 0; i < tr.length; i++) {
    sum += tr[i];
    if (i >= period) sum -= tr[i - period];
    out.push(i >= period - 1 ? sum / period : undefined);
  }
  return out;
}

const isSwingHigh = (c: readonly SmcCandle[], i: number, L: number): boolean => {
  for (let k = 1; k <= L; k++) if (c[i].high <= c[i - k].high || c[i].high <= c[i + k].high) return false;
  return true;
};
const isSwingLow = (c: readonly SmcCandle[], i: number, L: number): boolean => {
  for (let k = 1; k <= L; k++) if (c[i].low >= c[i - k].low || c[i].low >= c[i + k].low) return false;
  return true;
};

const dayKey = (iso: string): string => iso.slice(0, 10);
/** Monday (UTC) of the candle's week, as YYYY-MM-DD. */
const weekKey = (iso: string): string => {
  const d = new Date(iso);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow));
  return m.toISOString().slice(0, 10);
};

// ── higher-timeframe bias ───────────────────────────────────────────────
export function runBias(c: readonly SmcCandle[], L: number, atrPeriod: number): { bias: SmcBias; event: string } {
  const atr = atrSeries(c, atrPeriod);
  let protHigh = 0;
  let protLow = 0;
  let bias: SmcBias = "Neutral";
  let event = "--";
  for (let t = 0; t < c.length; t++) {
    const i = t - L;
    if (i >= L) {
      if (isSwingHigh(c, i, L)) protHigh = c[i].high;
      if (isSwingLow(c, i, L)) protLow = c[i].low;
    }
    const a = atr[t];
    if (a === undefined || t < 1 || protHigh <= 0 || protLow <= 0) continue;
    const minDisp = a * 0.5;
    const c1 = c[t].close;
    const c2 = c[t - 1].close;
    if (c1 > protHigh && c2 <= protHigh) {
      const strong = c1 - protHigh >= minDisp;
      if (bias === "Bearish") event = strong ? "MSS" : "Weak MSS";
      else event = strong ? "BOS" : "Weak BOS";
      bias = "Bullish";
    }
    if (c1 < protLow && c2 >= protLow) {
      const strong = protLow - c1 >= minDisp;
      if (bias === "Bullish") event = strong ? "MSS" : "Weak MSS";
      else event = strong ? "BOS" : "Weak BOS";
      bias = "Bearish";
    }
  }
  return { bias, event };
}

// ── lower-timeframe structure ───────────────────────────────────────────
const buySide = (k: PoolKind): boolean => k === "EQH" || k === "PDH" || k === "PWH";

/**
 * Runs the chronological scan over CLOSED candles (oldest first) and returns the
 * analysis as of the last closed candle. `livePrice` is the forming candle's close
 * (used for location / nearest pool). Returns null when there is not enough data.
 */
export function analyzeSmc(
  closed: readonly SmcCandle[],
  livePrice: number,
  htfClosed: readonly SmcCandle[] | null,
  params: SmcParams = DEFAULT_SMC_PARAMS,
): SmcAnalysis | null {
  const L = params.swingLength;
  const n = closed.length;
  if (n < L * 2 + params.atrPeriod + 10) return null;
  const atr = atrSeries(closed, params.atrPeriod);
  const lastAtr = atr[n - 1];
  if (lastAtr === undefined || lastAtr <= 0) return null;

  let lastPH = 0, prevPH = 0, lastPL = 0, prevPL = 0;
  let protHigh = 0, protLow = 0;
  let bias: SmcBias = "Neutral";
  let lastEvent: SmcEvent | null = null;
  const eventLog: SmcEvent[] = [];
  let lastSweep: { kind: PoolKind; idx: number } | null = null;
  const swingHighs: { idx: number; price: number }[] = [];
  const swingLows: { idx: number; price: number }[] = [];
  const pools: LiquidityPool[] = [];
  const zones: SmcZone[] = [];

  const addPool = (kind: PoolKind, price: number, formedIdx: number, tol: number) => {
    if (price <= 0) return;
    if (pools.some((p) => p.kind === kind && Math.abs(p.price - price) <= tol)) return;
    pools.push({ kind, price, status: "untouched", formedIdx });
    if (pools.length > 24) pools.shift();
  };
  const addZone = (z: Omit<SmcZone, "status">) => {
    if (z.top <= z.bot) return;
    if (zones.some((q) => q.kind === z.kind && q.anchorIdx === z.anchorIdx)) return;
    zones.push({ ...z, status: "fresh" });
    if (zones.length > 40) zones.shift();
  };

  // per-day / per-week extremes for PDH/PDL/PWH/PWL
  let curDay = dayKey(closed[0].time), dayHi = closed[0].high, dayLo = closed[0].low;
  let curWeek = weekKey(closed[0].time), weekHi = closed[0].high, weekLo = closed[0].low;

  for (let t = 0; t < n; t++) {
    const a = atr[t];
    const bar = closed[t];

    // previous day / week completed at this bar
    if (t > 0) {
      const dk = dayKey(bar.time);
      if (dk !== curDay) {
        if (a !== undefined) {
          addPool("PDH", dayHi, t, a * params.eqToleranceAtr);
          addPool("PDL", dayLo, t, a * params.eqToleranceAtr);
        }
        curDay = dk;
        dayHi = bar.high;
        dayLo = bar.low;
      } else {
        dayHi = Math.max(dayHi, bar.high);
        dayLo = Math.min(dayLo, bar.low);
      }
      const wk = weekKey(bar.time);
      if (wk !== curWeek) {
        if (a !== undefined) {
          addPool("PWH", weekHi, t, a * params.eqToleranceAtr);
          addPool("PWL", weekLo, t, a * params.eqToleranceAtr);
        }
        curWeek = wk;
        weekHi = bar.high;
        weekLo = bar.low;
      } else {
        weekHi = Math.max(weekHi, bar.high);
        weekLo = Math.min(weekLo, bar.low);
      }
    }
    if (a === undefined || a <= 0) continue;

    // confirm the swing that has just become confirmable (L bars to its right)
    const si = t - L;
    if (si >= L) {
      if (isSwingHigh(closed, si, L)) {
        prevPH = lastPH;
        lastPH = closed[si].high;
        protHigh = lastPH;
        const tol = a * params.eqToleranceAtr;
        const eq = swingHighs.slice(-20).find((s) => Math.abs(s.price - lastPH) <= tol);
        swingHighs.push({ idx: si, price: lastPH });
        if (eq) addPool("EQH", Math.max(eq.price, lastPH), t, tol);
      }
      if (isSwingLow(closed, si, L)) {
        prevPL = lastPL;
        lastPL = closed[si].low;
        protLow = lastPL;
        const tol = a * params.eqToleranceAtr;
        const eq = swingLows.slice(-20).find((s) => Math.abs(s.price - lastPL) <= tol);
        swingLows.push({ idx: si, price: lastPL });
        if (eq) addPool("EQL", Math.min(eq.price, lastPL), t, tol);
      }
    }

    // structure: a close through the protected high / low
    if (t >= 1 && protHigh > 0 && protLow > 0) {
      const minDisp = a * 0.5;
      const c1 = bar.close;
      const c2 = closed[t - 1].close;
      if (c1 > protHigh && c2 <= protHigh) {
        const strong = c1 - protHigh >= minDisp;
        lastEvent = { kind: bias === "Bearish" ? "MSS" : "BOS", dir: "Bullish", strong, barIdx: t, level: protHigh };
        eventLog.push(lastEvent);
        bias = "Bullish";
      }
      if (c1 < protLow && c2 >= protLow) {
        const strong = protLow - c1 >= minDisp;
        lastEvent = { kind: bias === "Bullish" ? "MSS" : "BOS", dir: "Bearish", strong, barIdx: t, level: protLow };
        eventLog.push(lastEvent);
        bias = "Bearish";
      }
    }

    // liquidity sweeps / tests (pools that existed before this bar)
    const reclaim = a * params.sweepReclaimAtr;
    for (const p of pools) {
      if (p.status === "swept" || p.formedIdx >= t) continue;
      if (buySide(p.kind)) {
        if (bar.high > p.price && bar.close < p.price && bar.high - bar.close >= reclaim) {
          p.status = "swept";
          p.sweptIdx = t;
          lastSweep = { kind: p.kind, idx: t };
        } else if (bar.high >= p.price && p.status === "untouched") p.status = "tested";
      } else if (bar.low < p.price && bar.close > p.price && bar.close - bar.low >= reclaim) {
        p.status = "swept";
        p.sweptIdx = t;
        lastSweep = { kind: p.kind, idx: t };
      } else if (bar.low <= p.price && p.status === "untouched") p.status = "tested";
    }

    // order block: a displacement candle in the direction of the current bias
    const body = Math.abs(bar.close - bar.open);
    if (body >= a * 0.6) {
      if (bar.close > bar.open && bias === "Bullish") {
        for (let k = t - 1; k >= Math.max(0, t - 6); k--) {
          if (closed[k].close < closed[k].open) {
            addZone({ kind: "OB", dir: 1, top: closed[k].high, bot: closed[k].low, anchorIdx: k, createdIdx: t });
            break;
          }
        }
      } else if (bar.close < bar.open && bias === "Bearish") {
        for (let k = t - 1; k >= Math.max(0, t - 6); k--) {
          if (closed[k].close > closed[k].open) {
            addZone({ kind: "OB", dir: -1, top: closed[k].high, bot: closed[k].low, anchorIdx: k, createdIdx: t });
            break;
          }
        }
      }
    }

    // fair value gap: three-candle imbalance ending at this bar
    if (t >= 2) {
      const minGap = a * 0.15;
      const gapUp = bar.low - closed[t - 2].high;
      const gapDn = closed[t - 2].low - bar.high;
      if (gapUp > minGap) addZone({ kind: "FVG", dir: 1, top: bar.low, bot: closed[t - 2].high, anchorIdx: t - 2, createdIdx: t });
      else if (gapDn > minGap) addZone({ kind: "FVG", dir: -1, top: closed[t - 2].low, bot: bar.high, anchorIdx: t - 2, createdIdx: t });
    }

    // zone mitigation (only bars AFTER the zone formed) and expiry by bar count
    for (const z of zones) {
      if (z.status === "mitigated") continue;
      if (t - z.anchorIdx > params.zoneMaxAgeBars) {
        z.status = "mitigated";
        continue;
      }
      if (t <= z.createdIdx) continue; // the bar that created the zone never mitigates it
      const height = z.top - z.bot;
      if (height <= 0 || bar.high < z.bot || bar.low > z.top) continue;
      const fill = z.dir === 1 ? ((z.top - Math.max(bar.low, z.bot)) / height) * 100 : ((Math.min(bar.high, z.top) - z.bot) / height) * 100;
      const pct = Math.min(100, Math.max(0, fill));
      const kill = z.kind === "OB" ? params.obMitigationPct : params.fvgMitigationPct;
      if (pct >= kill) z.status = "mitigated";
      else if (z.status === "fresh") z.status = "tested";
    }
  }

  // ── derived state as of the last closed candle ──
  const lastIdx = n - 1;
  const htf = htfClosed && htfClosed.length >= params.htfSwingLength * 2 + params.atrPeriod + 5 ? runBias(htfClosed, params.htfSwingLength, params.atrPeriod) : { bias: "Neutral" as SmcBias, event: "--" };

  const sweepBars = lastSweep ? lastIdx - lastSweep.idx : null;
  const sweepFresh = lastSweep !== null && sweepBars !== null && sweepBars <= params.sweepValidBars;

  const live = pools.filter((p) => p.status !== "swept");
  let nearest: SmcAnalysis["nearestPool"] = null;
  for (const p of live) {
    const d = Math.abs(p.price - livePrice);
    if (!nearest || d < nearest.distance) nearest = { ...p, distance: d, side: p.price >= livePrice ? "above" : "below" };
  }

  const activeOb = [...zones].reverse().find((z) => z.kind === "OB" && z.status !== "mitigated") ?? null;
  const activeFvg = [...zones].reverse().find((z) => z.kind === "FVG" && z.status !== "mitigated") ?? null;

  let location: SmcAnalysis["location"] = "--";
  let range: SmcAnalysis["range"] = null;
  if (lastPH > 0 && lastPL > 0) {
    const hi = Math.max(lastPH, prevPH);
    const lo = prevPL > 0 ? Math.min(lastPL, prevPL) : lastPL;
    if (hi > lo) {
      range = { high: hi, low: lo };
      const eq = (hi + lo) / 2;
      location = livePrice > eq ? "Premium" : livePrice < eq ? "Discount" : "Equilibrium";
    }
  }

  const recent = atr.slice(Math.max(0, n - 50), n - 1).filter((x): x is number => x !== undefined);
  let volatility: SmcAnalysis["volatility"] = "--";
  let volatilityRatio: number | null = null;
  if (recent.length > 0) {
    const avg = recent.reduce((s, x) => s + x, 0) / recent.length;
    if (avg > 0) {
      volatilityRatio = lastAtr / avg;
      volatility = volatilityRatio > 1.3 ? "High" : volatilityRatio < 0.7 ? "Low" : "Normal";
    }
  }

  // ── score (the owner's v2 weights; the MSS bonus is now inside the denominator) ──
  const factors: SmcScoreFactor[] = [];
  const add = (label: string, points: number, max: number) => factors.push({ label, points, max });
  const aligned = htf.bias === bias && bias !== "Neutral";

  let p1 = 0;
  if (aligned) {
    p1 = 25;
    if (htf.event.includes("MSS") && !htf.event.includes("Weak")) p1 += 3;
  } else if (htf.bias !== "Neutral" && bias !== "Neutral") p1 = -10;
  add("HTF alignment", p1, 28);

  let p2 = 0;
  if (sweepFresh && lastSweep) {
    const bs = buySide(lastSweep.kind);
    const fit = (bias === "Bullish" && !bs) || (bias === "Bearish" && bs);
    const premium = ["EQH", "EQL", "PDH", "PDL"].includes(lastSweep.kind);
    p2 = fit ? (premium ? 22 : 15) : -5;
  }
  add("Fresh liquidity sweep", p2, 22);

  let p3 = 0;
  if (lastEvent) p3 = lastEvent.kind === "MSS" ? (lastEvent.strong ? 20 : 10) : lastEvent.strong ? 14 : 7;
  add("Structure event", p3, 20);

  let p4 = 0;
  if (activeOb) {
    const fit = (bias === "Bullish" && activeOb.dir === 1) || (bias === "Bearish" && activeOb.dir === -1);
    p4 = fit ? (activeOb.status === "fresh" ? 15 : 8) : 2;
  }
  add("Order block", p4, 15);

  let p5 = 0;
  if (activeFvg) {
    const fit = (bias === "Bullish" && activeFvg.dir === 1) || (bias === "Bearish" && activeFvg.dir === -1);
    p5 = fit ? (activeFvg.status === "fresh" ? 10 : 5) : 1;
  }
  add("Fair value gap", p5, 10);

  let p6 = 0;
  if ((bias === "Bullish" && location === "Discount") || (bias === "Bearish" && location === "Premium")) p6 = 8;
  else if (location === "Equilibrium") p6 = 3;
  else if (location !== "--") p6 = -3;
  add("Premium / discount", p6, 8);

  let p7 = 0;
  if (volatility === "Normal") p7 = 5;
  else if (volatility === "Low") p7 = 2;
  else if (volatility === "High") p7 = -3;
  add("Volatility", p7, 5);

  const raw = factors.reduce((s, f) => s + f.points, 0);
  const maxRaw = factors.reduce((s, f) => s + f.max, 0);
  const score = Math.round(Math.min(100, Math.max(0, (raw / maxRaw) * 100)));

  const strength: SmcAnalysis["strength"] = aligned && score >= params.scoreStrong ? "strong" : aligned && score >= params.scoreDeveloping ? "developing" : "weak";
  const lean: SmcAnalysis["lean"] = strength === "weak" ? "none" : bias === "Bullish" ? "bullish-leaning" : "bearish-leaning";

  return {
    lastClosedIdx: lastIdx,
    lastClosedTime: closed[lastIdx].time,
    price: livePrice,
    atr: lastAtr,
    bias,
    lastEvent: lastEvent ? { ...lastEvent, barsAgo: lastIdx - lastEvent.barIdx } : null,
    eventLog: eventLog.slice(-20).map((e) => ({ ...e })),
    htf,
    sweep: lastSweep && sweepBars !== null ? { kind: lastSweep.kind, barsAgo: sweepBars, fresh: sweepFresh } : null,
    pools: pools.map((p) => ({ ...p })),
    nearestPool: nearest,
    ob: activeOb ? { ...activeOb } : null,
    fvg: activeFvg ? { ...activeFvg } : null,
    location,
    range,
    volatility,
    volatilityRatio,
    score,
    factors,
    aligned,
    lean,
    strength,
  };
}
