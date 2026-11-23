// services/chart/chart-signal.service.ts
// Pro Chart signal record. record(): stores a generated trade plan once (a re-run of the same plan on the same candle is the same signal).
// resolveOpen(): follows unfinished signals on the candles that came after them and writes what happened (lib/chart-engine/signals/outcome.ts).
// Lazy: it runs when somebody opens the record, no scheduler. Everything is measured, before spread and commission; nothing is predicted.
import { prisma } from "@/lib/prisma";
import { marketData } from "@/services/market-data/shared-instance";
import { PROVIDER_INTERVAL } from "@/services/intelligence/hypothesis/hypothesis-outcome-evaluator.service";
import { normalizeCandles } from "@/lib/chart-engine/candle-normalizer";
import { isSignalTimeframe, type SignalTimeframe } from "@/types/signal";
import { isChartableSymbol } from "@/services/chart/chart-drawing.service";
import { Errors } from "@/services/backend/ErrorHandler";
import { dedupeKeyOf, parseRecordInput, type RecordInput } from "@/lib/chart-engine/signals/record-input";
export { parseRecordInput, dedupeKeyOf };
export type { RecordInput };
import { isFinished, resolveOutcome, type SignalStatus } from "@/lib/chart-engine/signals/outcome";
import { summarize, type SignalSummary } from "@/lib/chart-engine/signals/stats";

export const MAX_SIGNALS_PER_USER_PER_DAY = 100;
const MAX_ROWS_PER_RESOLVE = 60;
const CANDLES_PER_FETCH = 400;

export interface SignalView {
  id: string;
  symbol: string;
  timeframe: string;
  dir: string;
  entryType: string;
  entry: number;
  stop: number;
  target: number;
  rr: number;
  score: number;
  scoreMax: number;
  status: SignalStatus;
  resultR: number | null;
  createdAt: string;
  closedAt: string | null;
}

type Row = Awaited<ReturnType<typeof prisma.chartSignal.findFirstOrThrow>>;
const view = (r: Row): SignalView => ({
  id: r.id, symbol: r.symbol, timeframe: r.timeframe, dir: r.dir, entryType: r.entryType, entry: r.entry, stop: r.stop, target: r.target, rr: r.rr,
  score: r.score, scoreMax: r.scoreMax, status: r.status as SignalStatus, resultR: r.resultR, createdAt: r.createdAt.toISOString(), closedAt: r.closedAt ? r.closedAt.toISOString() : null,
});

export class ChartSignalService {
  /** Stores the plan (idempotent per user + plan + candle). Returns whether a NEW signal was recorded. */
  async record(userId: string, input: RecordInput): Promise<{ recorded: boolean }> {
    if (!(await isChartableSymbol(input.symbol))) throw Errors.validation("Unknown symbol", { symbol: input.symbol });
    const since = new Date(Date.now() - 86_400_000);
    const today = await prisma.chartSignal.count({ where: { userId, createdAt: { gte: since } } });
    const dedupeKey = dedupeKeyOf(input);
    const exists = await prisma.chartSignal.findUnique({ where: { userId_dedupeKey: { userId, dedupeKey } }, select: { id: true } });
    if (exists) return { recorded: false };
    if (today >= MAX_SIGNALS_PER_USER_PER_DAY) throw Errors.validation("Daily signal record limit reached.");
    await prisma.chartSignal.create({
      data: {
        userId, symbol: input.symbol, timeframe: input.timeframe, dir: input.dir, entryType: input.entryType, entry: input.entry, stop: input.stop, target: input.target, rr: input.rr,
        score: input.score, scoreMax: input.scoreMax, confluences: input.confluences, source: input.source ?? null, signalTime: new Date(input.signalTime), lastClose: input.lastClose, dedupeKey,
      },
    });
    return { recorded: true };
  }

  /** Follows unfinished signals on the candles after them. One candle fetch per symbol + timeframe. Returns how many rows changed. */
  async resolveOpen(where: { userId?: string }): Promise<number> {
    const rows = await prisma.chartSignal.findMany({ where: { ...where, status: { in: ["open", "live"] } }, orderBy: { createdAt: "asc" }, take: MAX_ROWS_PER_RESOLVE });
    const groups = new Map<string, Row[]>();
    for (const r of rows) {
      const k = `${r.symbol}|${r.timeframe}`;
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    let changed = 0;
    for (const [key, list] of groups) {
      const [symbol, timeframe] = key.split("|") as [string, SignalTimeframe];
      if (!isSignalTimeframe(timeframe)) continue;
      let candles: { time: number; high: number; low: number; close: number }[];
      try {
        const res = await marketData.getTimeSeriesWithProvenance({ symbol, interval: PROVIDER_INTERVAL[timeframe], outputSize: CANDLES_PER_FETCH });
        candles = normalizeCandles(res.candles).candles;
      } catch {
        continue; // data unavailable right now: the signals simply stay unresolved, nothing is guessed
      }
      for (const r of list) {
        const o = resolveOutcome({ dir: r.dir as "long" | "short", entryType: r.entryType as "market" | "limit", entry: r.entry, stop: r.stop, target: r.target, rr: r.rr, signalTime: r.signalTime.getTime() }, candles);
        const same = o.status === r.status && (o.resolvedThrough ?? null) === (r.resolvedThrough ? r.resolvedThrough.getTime() : null);
        if (same) continue;
        await prisma.chartSignal.update({
          where: { id: r.id },
          data: { status: o.status, filledAt: o.filledAt ? new Date(o.filledAt) : null, closedAt: o.closedAt ? new Date(o.closedAt) : null, resultR: o.resultR, resolvedThrough: o.resolvedThrough ? new Date(o.resolvedThrough) : null },
        });
        if (isFinished(o.status) || o.status !== r.status) changed++;
      }
    }
    return changed;
  }

  async mine(userId: string, limit = 30): Promise<{ signals: SignalView[]; summary: SignalSummary }> {
    await this.resolveOpen({ userId });
    const [recent, all] = await Promise.all([
      prisma.chartSignal.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: Math.min(100, Math.max(1, limit)) }),
      prisma.chartSignal.findMany({ where: { userId }, select: { status: true, resultR: true, rr: true } }),
    ]);
    return { signals: recent.map(view), summary: summarize(all.map((r) => ({ status: r.status as SignalStatus, resultR: r.resultR, rr: r.rr }))) };
  }

  /** Platform-wide scoreboard for the admin page. */
  async platform(): Promise<{ summary: SignalSummary; bySymbol: { symbol: string; summary: SignalSummary }[]; recent: SignalView[]; users: number }> {
    await this.resolveOpen({});
    const [all, recent, users] = await Promise.all([
      prisma.chartSignal.findMany({ select: { symbol: true, status: true, resultR: true, rr: true } }),
      prisma.chartSignal.findMany({ orderBy: { createdAt: "desc" }, take: 40 }),
      prisma.chartSignal.findMany({ distinct: ["userId"], select: { userId: true } }),
    ]);
    const rows = all.map((r) => ({ symbol: r.symbol, status: r.status as SignalStatus, resultR: r.resultR, rr: r.rr }));
    const symbols = [...new Set(rows.map((r) => r.symbol))];
    return {
      summary: summarize(rows),
      bySymbol: symbols.map((symbol) => ({ symbol, summary: summarize(rows.filter((r) => r.symbol === symbol)) })).sort((a, b) => b.summary.total - a.summary.total),
      recent: recent.map(view),
      users: users.length,
    };
  }
}

export const chartSignalService = new ChartSignalService();
