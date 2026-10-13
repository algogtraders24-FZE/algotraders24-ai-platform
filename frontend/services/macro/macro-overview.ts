// services/macro/macro-overview.ts
// Compact Macro Alignment for every asset - the dashboard's mini cards. Built
// from the same snapshots as the full card, so the numbers always agree.
//
// Assets are fetched one after another in priority order (not in parallel): the
// quotes shared between assets are cached after the first asset, and Twelve Data
// Basic allows 8 requests/minute. An asset whose quote could not be fetched in
// time shows "not enough data" - it is never estimated.

import { ASSET_PROFILES, type AlignmentLean, type AssetId } from "./macro-alignment";
import type { SmcSummary } from "@/services/smc/smc-service";
import { getMacroAlignmentSnapshot, type MacroAlignmentSnapshot, type MacroPrice } from "./macro-service";
import type { FetchLike } from "./macro-data";

export interface MacroOverviewItem {
  asset: AssetId;
  title: string;
  lean: AlignmentLean;
  label: string;
  score: number | null;
  availableDrivers: number;
  totalDrivers: number;
  price: MacroPrice | null;
  /** Market-structure lean from the SMC engine (rule-based, unvalidated weights; not a signal). Absent when not requested or when there was not enough candle data. */
  smc?: SmcSummary;
}

/** Dashboard mini cards. Most useful first: if the minute's quota runs out, the last ones degrade. */
export const OVERVIEW_ORDER: readonly AssetId[] = ["gold", "btcusd", "eurusd", "usdjpy", "oil"];
/** The AI Signals page's instruments (same set as /api/private/intelligence/overview), in its display order. */
export const SIGNALS_ORDER: readonly AssetId[] = ["eurusd", "gbpusd", "usdjpy", "gold", "silver", "btcusd", "ethusd"];

export function toOverviewItem(s: MacroAlignmentSnapshot): MacroOverviewItem {
  return {
    asset: s.asset,
    title: s.title,
    lean: s.alignment.lean,
    label: s.alignment.label,
    score: s.alignment.score,
    availableDrivers: s.alignment.availableDrivers,
    totalDrivers: s.alignment.totalDrivers,
    price: s.price,
  };
}

export async function getMacroOverview(f?: FetchLike, order: readonly AssetId[] = OVERVIEW_ORDER): Promise<MacroOverviewItem[]> {
  const items: MacroOverviewItem[] = [];
  for (const asset of order) {
    try {
      items.push(toOverviewItem(await getMacroAlignmentSnapshot(asset, f)));
    } catch {
      // one asset failing must not blank the others
    }
  }
  // keep the requested display order even if one was skipped
  return order.map((id) => items.find((i) => i.asset === id)).filter((i): i is MacroOverviewItem => i !== undefined);
}

const SMC_TIMEOUT_MS = 5000;

/**
 * Adds each asset's SMC structure summary, all in parallel. An asset with no
 * symbol, no data, a failure or a timeout simply gets no `smc` - never estimated.
 */
export async function attachSmc(
  items: MacroOverviewItem[],
  getSummary: (symbol: string) => Promise<SmcSummary | null>,
  timeoutMs: number = SMC_TIMEOUT_MS,
): Promise<MacroOverviewItem[]> {
  return Promise.all(
    items.map(async (item) => {
      const symbol = ASSET_PROFILES[item.asset].miSymbol;
      if (!symbol) return item;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const summary = await Promise.race([
          getSummary(symbol),
          new Promise<null>((resolve) => {
            timer = setTimeout(() => resolve(null), timeoutMs);
          }),
        ]);
        return summary ? { ...item, smc: summary } : item;
      } catch {
        return item;
      } finally {
        if (timer) clearTimeout(timer);
      }
    }),
  );
}
