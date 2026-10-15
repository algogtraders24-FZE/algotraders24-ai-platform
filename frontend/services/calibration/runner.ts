// services/calibration/runner.ts
// Issue one forecast per symbol per 4-hour slot and settle the ones whose time has passed. Dependencies are injected so the
// loop is testable offline; production wiring is production.ts. Never throws to the cron: a failed symbol is skipped.

import { buildForecast, settle, type NewForecast, type Settlement, type StoredForecast } from "./forecast";

export interface CalibrationDeps {
  symbols: readonly string[];
  /** Latest analysis for a symbol, or null when there is no data. `fresh` bypasses any short-lived "no data" cache (used for the one retry after a transient failure). */
  getAnalysis: (symbol: string, fresh?: boolean) => Promise<{ price: number; atr: number; lastClosedTime: string } | null>;
  /** Pause before the single retry (ms); default 2500, tests pass 0. */
  retryDelayMs?: number;
  /** Inserts when (symbol, issuedAt) is new; returns false when it already existed. */
  insertForecast: (f: NewForecast) => Promise<boolean>;
  /** Forecasts of the symbol with at least one unsettled horizon (oldest first, capped). */
  listUnsettled: (symbol: string) => Promise<StoredForecast[]>;
  /** Hourly candles (oldest first): open time (UTC ms) and close. */
  getHourly: (symbol: string) => Promise<Array<{ openMs: number; close: number }>>;
  saveSettlement: (id: string, s: Settlement) => Promise<void>;
}

export interface CalibrationRunResult {
  issued: number;
  duplicates: number;
  noData: number;
  settled: number;
  voided: number;
}

export async function runCalibrationWith(deps: CalibrationDeps, now: Date = new Date()): Promise<CalibrationRunResult> {
  const res: CalibrationRunResult = { issued: 0, duplicates: 0, noData: 0, settled: 0, voided: 0 };
  await Promise.all(
    deps.symbols.map(async (symbol) => {
      try {
        // 1) issue
        let a = await deps.getAnalysis(symbol).catch(() => null);
        if (!a) {
          // A transient provider hiccup must not leave a hole in the scoreboard: one fresh retry.
          await new Promise((r) => setTimeout(r, deps.retryDelayMs ?? 2500));
          a = await deps.getAnalysis(symbol, true).catch(() => null);
        }
        const f = a ? buildForecast(symbol, a, now) : null;
        if (!f) res.noData++;
        else if (await deps.insertForecast(f)) res.issued++;
        else res.duplicates++;

        // 2) settle
        const open = await deps.listUnsettled(symbol);
        if (open.length === 0) return;
        const hourly = await deps.getHourly(symbol).catch(() => []);
        const byOpen = new Map(hourly.map((c) => [c.openMs, c.close]));
        for (const row of open) {
          // the candle that ENDS h hours after the slot opened h-1 hours after it
          const closeAt = (h: number) => byOpen.get(row.issuedAt.getTime() + (h - 1) * 3_600_000) ?? null;
          for (const s of settle(row, now, closeAt)) {
            await deps.saveSettlement(row.id, s);
            if (s.inside === null) res.voided++;
            else res.settled++;
          }
        }
      } catch {
        res.noData++;
      }
    }),
  );
  return res;
}
