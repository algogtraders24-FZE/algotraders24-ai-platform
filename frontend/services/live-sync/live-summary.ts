// services/live-sync/live-summary.ts
// Pure summary of recent snapshots for the Live panel. No DB, no network.
// Only facts the snapshots contain; margin level and floating P&L are plain
// arithmetic on them. No predictions.

import type { WirePosition } from "./contract";

export interface SnapshotRow {
  time: number;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  positions: WirePosition[];
}

export interface ExposureRow {
  symbol: string;
  buyVolume: number;
  sellVolume: number;
  netVolume: number;
  floating: number;
}

export interface LiveSummary {
  /** False when no snapshot exists in the window. */
  hasData: boolean;
  /** True when the newest snapshot is older than `STALE_MS`: the EA is probably not running. */
  stale: boolean;
  latest: (SnapshotRow & { floating: number; marginLevelPct: number | null }) | null;
  /** Equity points, downsampled to at most `maxPoints`. */
  series: { t: number; equity: number; balance: number }[];
  equityHigh: number | null;
  equityLow: number | null;
  /** Largest peak-to-trough equity drop inside the window, as a percent of the peak. */
  windowDrawdownPct: number | null;
  exposure: ExposureRow[];
  /** Open positions without a stop loss. */
  withoutStopLoss: number;
}

export const STALE_MS = 3 * 60_000;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function summarizeLive(rows: readonly SnapshotRow[], now: number, maxPoints = 120): LiveSummary {
  if (rows.length === 0) {
    return { hasData: false, stale: true, latest: null, series: [], equityHigh: null, equityLow: null, windowDrawdownPct: null, exposure: [], withoutStopLoss: 0 };
  }
  const last = rows[rows.length - 1];
  const floating = r2(last.equity - last.balance);
  const marginLevelPct = last.margin > 0 ? r2((last.equity / last.margin) * 100) : null;

  let high = -Infinity, low = Infinity, peak = -Infinity, maxDd = 0;
  for (const r of rows) {
    if (r.equity > high) high = r.equity;
    if (r.equity < low) low = r.equity;
    if (r.equity > peak) peak = r.equity;
    if (peak > 0) maxDd = Math.max(maxDd, ((peak - r.equity) / peak) * 100);
  }

  const step = Math.max(1, Math.ceil(rows.length / maxPoints));
  const series: LiveSummary["series"] = [];
  for (let i = 0; i < rows.length; i += step) series.push({ t: rows[i].time, equity: rows[i].equity, balance: rows[i].balance });
  if (series[series.length - 1].t !== last.time) series.push({ t: last.time, equity: last.equity, balance: last.balance });

  const bySymbol = new Map<string, ExposureRow>();
  let withoutStopLoss = 0;
  for (const p of last.positions) {
    const e = bySymbol.get(p.symbol) ?? { symbol: p.symbol, buyVolume: 0, sellVolume: 0, netVolume: 0, floating: 0 };
    if (p.side === "buy") e.buyVolume += p.volume;
    else e.sellVolume += p.volume;
    e.netVolume = r2(e.buyVolume - e.sellVolume);
    e.buyVolume = r2(e.buyVolume);
    e.sellVolume = r2(e.sellVolume);
    e.floating = r2(e.floating + p.profit);
    bySymbol.set(p.symbol, e);
    if (!(p.sl > 0)) withoutStopLoss++;
  }

  return {
    hasData: true,
    stale: now - last.time > STALE_MS,
    latest: { ...last, floating, marginLevelPct },
    series,
    equityHigh: r2(high),
    equityLow: r2(low),
    windowDrawdownPct: r2(maxDd),
    exposure: [...bySymbol.values()].sort((a, b) => Math.abs(b.netVolume) - Math.abs(a.netVolume)),
    withoutStopLoss,
  };
}
