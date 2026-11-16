// services/market-board/indicators-more.ts
// More AT24 indicators for the Market Board: Absorption Map, FVG Zones, Order Block Lab and Volume Profile Levels.
// Ported one to one from the independent Python checks that matched the MetaTrader 5 builds (ea-research/indicators/*/test/verify_*.py);
// scripts/validate-market-board-more.ts replays the MT5 self-test files through this file and compares every zone, gap, block, trade and statistic.
// Closed bars only, chronological arrays, no network. Descriptive, not a signal.
import { atrWilder, scoreTrades, zonePlan, zoneTrades, ZONE_DEFAULTS, type Bar, type Score, type Zone, type ZonePlan } from "./indicators";

// ---------------------------------------------------------------------------------------------------------------------
// Absorption Map: heavy tick volume, small range, after a push -> zone; first retest scored like Zone Pro
// ---------------------------------------------------------------------------------------------------------------------
export interface AbsorptionParams {
  volK: number;
  volN: number;
  maxRange: number;
  look: number;
  moveAtr: number;
  slBuf: number;
  rr: number;
  hold: number;
  maxAge: number;
}
export const ABSORPTION_DEFAULTS: AbsorptionParams = { volK: 1.5, volN: 20, maxRange: 1.0, look: 6, moveAtr: 1.0, slBuf: 0.25, rr: 2.0, hold: 40, maxAge: 200 };

export function detectAbsorptionZones(H: number[], L: number[], C: number[], TV: number[], atr: number[], p: AbsorptionParams): Zone[] {
  const n = H.length;
  const zones: Zone[] = [];
  for (let i = Math.max(p.volN, p.look + 1) + 1; i < n; i++) {
    const a = atr[i - 1];
    if (a <= 0) continue;
    let sum = 0;
    for (let k = i - p.volN; k < i; k++) sum += TV[k];
    const avg = sum / p.volN;
    if (avg <= 0 || TV[i] < p.volK * avg) continue;
    const range = H[i] - L[i];
    if (range > p.maxRange * a || range <= 0) continue;
    const move = C[i - 1] - C[i - 1 - p.look];
    const dir: 1 | -1 | 0 = move <= -p.moveAtr * a ? 1 : move >= p.moveAtr * a ? -1 : 0;
    if (dir === 0) continue;
    zones.push({ idx: i, dir, top: H[i], bottom: L[i], atr: a, touch: -1 });
  }
  for (const z of zones) {
    const last = Math.min(n - 1, z.idx + p.maxAge);
    for (let k = z.idx + 1; k <= last; k++) {
      if ((z.dir > 0 && L[k] <= z.top) || (z.dir < 0 && H[k] >= z.bottom)) {
        z.touch = k;
        break;
      }
    }
  }
  return zones;
}

export interface AbsorptionBoard {
  fresh: Array<Zone & { plan: ZonePlan; time: string }>;
  touchedOnLastBar: boolean;
  /** sellers = sellers absorbed (demand side), buyers = buyers absorbed (supply side). */
  scores: { sellers: Score; buyers: Score; all: Score };
  zonesFound: number;
}

export function computeAbsorptionBoard(bars: readonly Bar[], cost: number, p: AbsorptionParams = ABSORPTION_DEFAULTS, drawPerSide = 3): AbsorptionBoard {
  const O = bars.map((b) => b.open);
  const H = bars.map((b) => b.high);
  const L = bars.map((b) => b.low);
  const C = bars.map((b) => b.close);
  const TV = bars.map((b) => b.volume);
  const n = bars.length;
  const atr = atrWilder(H, L, C);
  const zones = detectAbsorptionZones(H, L, C, TV, atr, p);
  const zp = { ...ZONE_DEFAULTS, slBuf: p.slBuf, rr: p.rr, hold: p.hold, maxAge: p.maxAge };
  const freshAll = zones.filter((z) => z.touch < 0 && n - 1 - z.idx <= p.maxAge);
  const pick = (dir: 1 | -1) => freshAll.filter((z) => z.dir === dir).slice(-drawPerSide);
  return {
    fresh: [...pick(1), ...pick(-1)].map((z) => ({ ...z, plan: zonePlan(z, zp), time: bars[z.idx].time })),
    touchedOnLastBar: zones.some((z) => z.touch === n - 1),
    scores: {
      sellers: scoreTrades(zoneTrades(O, H, L, C, zones, 1, zp, cost)),
      buyers: scoreTrades(zoneTrades(O, H, L, C, zones, -1, zp, cost)),
      all: scoreTrades(zoneTrades(O, H, L, C, zones, 0, zp, cost)),
    },
    zonesFound: zones.length,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// FVG Zones: three-bar gaps, how often they get touched and filled, against a control
// ---------------------------------------------------------------------------------------------------------------------
export interface FvgParams {
  len: number;
  minAtr: number;
  win: number;
  react: number;
}
export const FVG_DEFAULTS: FvgParams = { len: 14, minAtr: 0.3, win: 50, react: 20 };

export interface Gap {
  idx: number;
  dir: 1 | -1;
  top: number;
  bottom: number;
  touch: number;
  fill: number;
}

/** ATR for the gap code: simple average of the first `len` true ranges, then Wilder. */
function atrSeeded(H: number[], L: number[], C: number[], len: number): number[] {
  const n = H.length;
  const tr = [H[0] - L[0]];
  for (let i = 1; i < n; i++) tr.push(Math.max(H[i] - L[i], Math.abs(H[i] - C[i - 1]), Math.abs(L[i] - C[i - 1])));
  const atr = new Array<number>(n).fill(0);
  let s = 0;
  for (let i = 0; i < len; i++) s += tr[i];
  atr[len - 1] = s / len;
  for (let i = len; i < n; i++) atr[i] = (atr[i - 1] * (len - 1) + tr[i]) / len;
  return atr;
}

export function detectGaps(H: number[], L: number[], C: number[], p: FvgParams): Gap[] {
  const n = H.length;
  if (n <= p.len + 3) return [];
  const atr = atrSeeded(H, L, C, p.len);
  const gaps: Gap[] = [];
  for (let i = Math.max(2, p.len); i < n; i++) {
    let dir: 1 | -1;
    let top: number;
    let bot: number;
    if (L[i] > H[i - 2]) {
      dir = 1;
      top = L[i];
      bot = H[i - 2];
    } else if (H[i] < L[i - 2]) {
      dir = -1;
      top = L[i - 2];
      bot = H[i];
    } else continue;
    if (top - bot < p.minAtr * atr[i]) continue;
    let touch = -1;
    let fill = -1;
    for (let t = i + 1; t < n; t++) {
      const tc = dir === 1 ? L[t] <= top : H[t] >= bot;
      const fl = dir === 1 ? L[t] <= bot : H[t] >= top;
      if (tc && touch < 0) touch = t;
      if (fl) {
        fill = t;
        break;
      }
    }
    gaps.push({ idx: i, dir, top, bottom: bot, touch, fill });
  }
  return gaps;
}

export interface FvgStats {
  measured: number;
  touchedPct: number;
  filledPct: number;
  medianWaitBars: number;
  controlPct: number;
  reactedPct: number;
  touchedN: number;
}

export function fvgStats(H: number[], L: number[], C: number[], gaps: readonly Gap[], p: FvgParams): FvgStats | null {
  const n = H.length;
  let cnt = 0;
  let tch = 0;
  let fil = 0;
  let rc = 0;
  let cn = 0;
  let ct = 0;
  const wait: number[] = [];
  for (const g of gaps) {
    if (g.idx + p.win >= n) continue;
    cnt += 1;
    if (g.touch >= 0 && g.touch - g.idx <= p.win) {
      tch += 1;
      wait.push(g.touch - g.idx);
      const h = g.top - g.bottom;
      for (let u = g.touch; u <= Math.min(n - 1, g.touch + p.react); u++) {
        if (g.dir === 1 ? C[u] < g.bottom : C[u] > g.top) break;
        if (g.dir === 1 ? H[u] >= g.top + h : L[u] <= g.bottom - h) {
          rc += 1;
          break;
        }
      }
    }
    if (g.fill >= 0 && g.fill - g.idx <= p.win) fil += 1;
    const c = g.idx + 100;
    if (c + p.win < n) {
      const dist = g.dir === 1 ? C[g.idx] - g.top : g.bottom - C[g.idx];
      if (dist > 0) {
        cn += 1;
        const lvl = g.dir === 1 ? C[c] - dist : C[c] + dist;
        for (let t = c + 1; t <= c + p.win; t++) {
          if (g.dir === 1 ? L[t] <= lvl : H[t] >= lvl) {
            ct += 1;
            break;
          }
        }
      }
    }
  }
  if (cnt === 0 || tch === 0 || cn === 0) return null;
  wait.sort((a, b) => a - b);
  const mid = wait.length >> 1;
  const median = wait.length % 2 ? wait[mid] : (wait[mid - 1] + wait[mid]) / 2;
  return { measured: cnt, touchedPct: (100 * tch) / cnt, filledPct: (100 * fil) / cnt, medianWaitBars: median, controlPct: (100 * ct) / cn, reactedPct: (100 * rc) / tch, touchedN: tch };
}

export interface FvgBoard {
  /** Gaps not yet filled, nearest the present first per side. */
  open: Array<{ dir: 1 | -1; top: number; bottom: number; time: string }>;
  stats: FvgStats | null;
  gapsFound: number;
}

export function computeFvgBoard(bars: readonly Bar[], p: FvgParams = FVG_DEFAULTS, drawPerSide = 3): FvgBoard {
  const H = bars.map((b) => b.high);
  const L = bars.map((b) => b.low);
  const C = bars.map((b) => b.close);
  const n = bars.length;
  const gaps = detectGaps(H, L, C, p);
  const openGaps = gaps.filter((g) => g.fill < 0 && n - 1 - g.idx <= 500);
  const pick = (dir: 1 | -1) => openGaps.filter((g) => g.dir === dir).slice(-drawPerSide);
  return {
    open: [...pick(1), ...pick(-1)].map((g) => ({ dir: g.dir, top: g.top, bottom: g.bottom, time: bars[g.idx].time })),
    stats: fvgStats(H, L, C, gaps, p),
    gapsFound: gaps.length,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Order Block Lab: the last opposite candle before a displacement, how often it is revisited and reacted to, against a mirrored control
// ---------------------------------------------------------------------------------------------------------------------
export interface ObParams {
  k: number;
  touchWindow: number;
  look: number;
  frac: number;
}
export const OB_DEFAULTS: ObParams = { k: 1.0, touchWindow: 100, look: 24, frac: 0.5 };

export interface OrderBlock {
  /** The block candle and the bar that confirmed the displacement. */
  idx: number;
  conf: number;
  dir: 1 | -1;
  top: number;
  bottom: number;
  atr: number;
  touch: number;
  control: number;
  reaction: 1 | -1 | 0;
  controlReaction: 1 | -1 | 0;
}

function atrSeededZero(H: number[], L: number[], C: number[]): number[] {
  const n = H.length;
  const atr = new Array<number>(n).fill(0);
  let a = 0;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const tr = i === 0 ? H[i] - L[i] : Math.max(H[i] - L[i], Math.abs(H[i] - C[i - 1]), Math.abs(L[i] - C[i - 1]));
    if (i < 14) {
      s += tr;
      if (i === 13) {
        a = s / 14;
        atr[i] = a;
      }
    } else {
      a = (a * 13 + tr) / 14;
      atr[i] = a;
    }
  }
  return atr;
}

export function detectOrderBlocks(O: number[], H: number[], L: number[], C: number[], p: ObParams): OrderBlock[] {
  const n = H.length;
  const atr = atrSeededZero(H, L, C);
  const react = (tb: number, lv: number, sg: number, thr: number): 1 | -1 | 0 => {
    for (let u = tb; u <= Math.min(n - 1, tb + p.look); u++) {
      if ((C[u] - lv) * sg >= thr) return 1;
      if ((C[u] - lv) * -sg >= thr) return -1;
    }
    return 0;
  };
  const obs: OrderBlock[] = [];
  let lastJ = -10;
  for (let j = 15; j < n - 3; j++) {
    if (j - lastJ < 3) continue;
    let d: 1 | -1;
    if (C[j] < O[j]) d = 1;
    else if (C[j] > O[j]) d = -1;
    else continue;
    let conf = -1;
    for (let t = j + 1; t < j + 4; t++) {
      if (atr[t] <= 0) break;
      if (d === 1 && C[t] - H[j] >= p.k * atr[t]) {
        conf = t;
        break;
      }
      if (d === -1 && L[j] - C[t] >= p.k * atr[t]) {
        conf = t;
        break;
      }
    }
    if (conf < 0) continue;
    lastJ = j;
    const lv = d === 1 ? H[j] : L[j];
    const sg = d === 1 ? 1 : -1;
    const thr = p.frac * atr[conf];
    let touch = -1;
    let ctrl = -1;
    for (let u = conf + 1; u <= Math.min(n - 1, conf + p.touchWindow); u++) {
      if ((d === 1 && L[u] <= lv) || (d === -1 && H[u] >= lv)) {
        touch = u;
        break;
      }
    }
    const reaction = touch >= 0 ? react(touch, lv, sg, thr) : 0;
    const mir = 2 * C[conf] - lv;
    for (let u = conf + 1; u <= Math.min(n - 1, conf + p.touchWindow); u++) {
      if ((d === 1 && H[u] >= mir) || (d === -1 && L[u] <= mir)) {
        ctrl = u;
        break;
      }
    }
    const controlReaction = ctrl >= 0 ? react(ctrl, mir, -sg, thr) : 0;
    obs.push({ idx: j, conf, dir: d, top: H[j], bottom: L[j], atr: atr[conf], touch, control: ctrl, reaction, controlReaction });
  }
  return obs;
}

export interface ObStats {
  measured: number;
  touchedPct: number;
  controlTouchedPct: number;
  /** Of the decided touches, the share that moved away from the block (reaction), and the same for the mirrored control. */
  reactedPct: number;
  controlReactedPct: number;
  decided: number;
  controlDecided: number;
}

export function obStats(blocks: readonly OrderBlock[], n: number, p: ObParams): ObStats | null {
  const use = blocks.filter((x) => x.conf + p.touchWindow + p.look < n);
  const cnt = use.length;
  const dec = use.filter((x) => x.reaction !== 0);
  const cdec = use.filter((x) => x.controlReaction !== 0);
  if (cnt === 0 || dec.length === 0 || cdec.length === 0) return null;
  return {
    measured: cnt,
    touchedPct: (100 * use.filter((x) => x.touch >= 0).length) / cnt,
    controlTouchedPct: (100 * use.filter((x) => x.control >= 0).length) / cnt,
    reactedPct: (100 * dec.filter((x) => x.reaction === 1).length) / dec.length,
    controlReactedPct: (100 * cdec.filter((x) => x.controlReaction === 1).length) / cdec.length,
    decided: dec.length,
    controlDecided: cdec.length,
  };
}

export interface ObBoard {
  /** Blocks not yet revisited, newest per side. */
  fresh: Array<{ dir: 1 | -1; top: number; bottom: number; time: string }>;
  stats: ObStats | null;
  blocksFound: number;
}

export function computeObBoard(bars: readonly Bar[], p: ObParams = OB_DEFAULTS, drawPerSide = 3): ObBoard {
  const O = bars.map((b) => b.open);
  const H = bars.map((b) => b.high);
  const L = bars.map((b) => b.low);
  const C = bars.map((b) => b.close);
  const n = bars.length;
  const blocks = detectOrderBlocks(O, H, L, C, p);
  const fresh = blocks.filter((b) => b.touch < 0 && n - 1 - b.conf <= 400);
  const pick = (dir: 1 | -1) => fresh.filter((b) => b.dir === dir).slice(-drawPerSide);
  return {
    fresh: [...pick(1), ...pick(-1)].map((b) => ({ dir: b.dir, top: b.top, bottom: b.bottom, time: bars[b.idx].time })),
    stats: obStats(blocks, n, p),
    blocksFound: blocks.length,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Volume Profile Levels: daily profile (POC and value area) and a study of how the previous day's levels behaved the next day
// ---------------------------------------------------------------------------------------------------------------------
export interface VpParams {
  bins: number;
  valueArea: number;
  look: number;
  frac: number;
}
export const VP_DEFAULTS: VpParams = { bins: 60, valueArea: 0.7, look: 24, frac: 0.15 };

export interface VpDay {
  first: number;
  last: number;
  hi: number;
  lo: number;
  ok: boolean;
  poc: number;
  vah: number;
  val: number;
}

export function buildVpDays(T: number[], H: number[], L: number[], V: number[], p: VpParams): VpDay[] {
  const n = T.length;
  const days: VpDay[] = [];
  let cur: number | null = null;
  for (let i = 0; i < n; i++) {
    const dk = Math.floor(T[i] / 86400);
    if (dk !== cur) {
      cur = dk;
      days.push({ first: i, last: i, hi: H[i], lo: L[i], ok: false, poc: 0, vah: 0, val: 0 });
    } else {
      const d = days[days.length - 1];
      d.last = i;
      d.hi = Math.max(d.hi, H[i]);
      d.lo = Math.min(d.lo, L[i]);
    }
  }
  for (const d of days) {
    const rng = d.hi - d.lo;
    if (rng <= 0) continue;
    const bw = rng / p.bins;
    const prof = new Array<number>(p.bins).fill(0);
    let total = 0;
    for (let i = d.first; i <= d.last; i++) {
      const v = V[i];
      if (v <= 0) continue;
      const lo = L[i];
      const hi = H[i];
      total += v;
      if (hi - lo <= 0) {
        prof[Math.min(p.bins - 1, Math.floor((lo - d.lo) / bw))] += v;
        continue;
      }
      const b1 = Math.min(p.bins - 1, Math.floor((lo - d.lo) / bw));
      const b2 = Math.min(p.bins - 1, Math.floor((hi - d.lo) / bw));
      for (let b = b1; b <= b2; b++) {
        const bl = d.lo + b * bw;
        const bh = bl + bw;
        const ov = Math.min(hi, bh) - Math.max(lo, bl);
        if (ov > 0) prof[b] += (v * ov) / (hi - lo);
      }
    }
    if (total <= 0) continue;
    let pb = 0;
    for (let b = 1; b < p.bins; b++) if (prof[b] > prof[pb]) pb = b;
    let loI = pb;
    let upI = pb;
    let acc = prof[pb];
    while (acc < p.valueArea * total && (loI > 0 || upI < p.bins - 1)) {
      const dn = loI > 0 ? prof[loI - 1] : -1;
      const ab = upI < p.bins - 1 ? prof[upI + 1] : -1;
      if (ab >= dn) {
        upI += 1;
        acc += prof[upI];
      } else {
        loI -= 1;
        acc += prof[loI];
      }
    }
    d.poc = d.lo + (pb + 0.5) * bw;
    d.vah = d.lo + (upI + 1) * bw;
    d.val = d.lo + loI * bw;
    d.ok = true;
  }
  return days;
}

export interface VpStudyRow {
  name: "POC" | "VAH" | "VAL";
  days: number;
  touchPct: number;
  controlTouchPct: number;
  reactedPct: number;
  controlReactedPct: number;
  decided: number;
}

export function vpStudy(O: number[], H: number[], L: number[], C: number[], days: readonly VpDay[], p: VpParams): VpStudyRow[] {
  const names = ["POC", "VAH", "VAL"] as const;
  return names.map((name, l) => {
    let dn = 0;
    let tc = 0;
    let ct = 0;
    let rc = 0;
    let dc = 0;
    let crc = 0;
    let cdc = 0;
    for (let k = 1; k < days.length; k++) {
      if (!days[k - 1].ok) continue;
      const pd = days[k - 1];
      const lvl = [pd.poc, pd.vah, pd.val][l];
      const R = pd.hi - pd.lo;
      const op = O[days[k].first];
      if (op === lvl) continue;
      dn += 1;
      for (const pas of [0, 1]) {
        const Lx = pas === 0 ? lvl : op + (op - lvl);
        const s = op > Lx ? 1 : -1;
        let tb = -1;
        for (let i = days[k].first; i <= days[k].last; i++) {
          if (L[i] <= Lx && Lx <= H[i]) {
            tb = i;
            break;
          }
        }
        if (tb < 0) continue;
        if (pas === 0) tc += 1;
        else ct += 1;
        let res = 0;
        for (let u = tb; u <= Math.min(days[k].last, tb + p.look); u++) {
          const away = (C[u] - Lx) * s;
          const beyond = (C[u] - Lx) * -s;
          if (away >= p.frac * R) {
            res = 1;
            break;
          }
          if (beyond >= p.frac * R) {
            res = -1;
            break;
          }
        }
        if (res) {
          if (pas === 0) {
            dc += 1;
            if (res === 1) rc += 1;
          } else {
            cdc += 1;
            if (res === 1) crc += 1;
          }
        }
      }
    }
    return {
      name,
      days: dn,
      touchPct: dn ? (100 * tc) / dn : 0,
      controlTouchPct: dn ? (100 * ct) / dn : 0,
      reactedPct: dc ? (100 * rc) / dc : 0,
      controlReactedPct: cdc ? (100 * crc) / cdc : 0,
      decided: dc,
    };
  });
}

export interface VpBoard {
  /** The previous completed day's levels, extended over today. */
  levels: { poc: number; vah: number; val: number; day: string } | null;
  study: VpStudyRow[] | null;
}

export function computeVpBoard(bars: readonly Bar[], p: VpParams = VP_DEFAULTS): VpBoard {
  const T = bars.map((b) => Date.parse(b.time) / 1000);
  const O = bars.map((b) => b.open);
  const H = bars.map((b) => b.high);
  const L = bars.map((b) => b.low);
  const C = bars.map((b) => b.close);
  const V = bars.map((b) => b.volume);
  const days = buildVpDays(T, H, L, V, p);
  const prev = days.length >= 2 ? days[days.length - 2] : null;
  const levels = prev && prev.ok ? { poc: prev.poc, vah: prev.vah, val: prev.val, day: bars[prev.first].time } : null;
  const study = days.filter((d) => d.ok).length >= 10 ? vpStudy(O, H, L, C, days, p) : null;
  return { levels, study };
}
