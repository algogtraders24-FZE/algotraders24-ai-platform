// services/calibration/production.ts
// Production wiring for the calibration runner and the public scoreboard read: Prisma rows, the SMC engine's latest
// analysis and hourly candles from the shared market-data service.
import "server-only";
import { prisma } from "@/lib/prisma";
import { getSmcAnalysis } from "@/services/smc/smc-service";
import { SYMBOL_LABEL } from "@/services/market-alerts/alerts";
import { runCalibrationWith, type CalibrationDeps, type CalibrationRunResult } from "./runner";
import { pooled, summarise, type CalibrationRow } from "./forecast";

export const CALIBRATION_SYMBOLS: readonly string[] = Object.keys(SYMBOL_LABEL);
const MAX_UNSETTLED = 40;

/** ISO timestamp, treating a zone-less provider time as UTC. */
function openMs(dt: string): number {
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(dt);
  return new Date(hasZone ? dt : `${dt.replace(" ", "T")}Z`).getTime();
}

export function productionDeps(): CalibrationDeps {
  return {
    symbols: CALIBRATION_SYMBOLS,
    getAnalysis: async (symbol) => {
      const a = await getSmcAnalysis(symbol);
      return a ? { price: a.price, atr: a.atr, lastClosedTime: a.lastClosedTime } : null;
    },
    insertForecast: async (f) => {
      try {
        await prisma.rangeForecast.create({ data: { symbol: f.symbol, issuedAt: f.issuedAt, price: f.price, atr: f.atr, band12: f.band12, band24: f.band24 } });
        return true;
      } catch (e) {
        if ((e as { code?: string }).code === "P2002") return false; // this slot already has its forecast
        throw e;
      }
    },
    listUnsettled: async (symbol) => {
      const rows = await prisma.rangeForecast.findMany({
        where: { symbol, OR: [{ settled12: false }, { settled24: false }] },
        orderBy: { issuedAt: "asc" },
        take: MAX_UNSETTLED,
        select: { id: true, symbol: true, issuedAt: true, price: true, band12: true, band24: true, settled12: true, settled24: true },
      });
      return rows;
    },
    getHourly: async (symbol) => {
      const { marketData } = await import("@/services/market-data/shared-instance");
      const candles = await marketData.getTimeSeries({ symbol, interval: "1h", outputSize: 300 });
      return candles.map((c) => ({ openMs: openMs(c.datetime), close: c.close })).filter((c) => Number.isFinite(c.openMs));
    },
    saveSettlement: async (id, s) => {
      await prisma.rangeForecast.update({
        where: { id },
        data: s.horizon === 12 ? { settled12: true, inside12: s.inside, priceLater12: s.priceLater } : { settled24: true, inside24: s.inside, priceLater24: s.priceLater },
      });
    },
  };
}

export function runCalibration(now: Date = new Date()): Promise<CalibrationRunResult> {
  return runCalibrationWith(productionDeps(), now);
}

export interface Scoreboard {
  /** false when the table does not exist yet. */
  available: boolean;
  since: string | null;
  issued: number;
  bySymbol: CalibrationRow[];
  all: CalibrationRow[];
}

/** Read side for the public page. Never throws: a missing table gives an empty, honest scoreboard. */
export async function readScoreboard(): Promise<Scoreboard> {
  try {
    const [rows, first, issued] = await Promise.all([
      prisma.rangeForecast.findMany({ where: { OR: [{ settled12: true }, { settled24: true }] }, select: { symbol: true, inside12: true, inside24: true } }),
      prisma.rangeForecast.findFirst({ orderBy: { issuedAt: "asc" }, select: { issuedAt: true } }),
      prisma.rangeForecast.count(),
    ]);
    return { available: true, since: first ? first.issuedAt.toISOString() : null, issued, bySymbol: summarise(rows, CALIBRATION_SYMBOLS), all: pooled(rows) };
  } catch {
    return { available: false, since: null, issued: 0, bySymbol: summarise([], CALIBRATION_SYMBOLS), all: pooled([]) };
  }
}
