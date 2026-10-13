// services/market-data/mt5-symbol-groups.ts
// Pure helper for the admin MT5 symbols diagnostic: sorts the raw symbol names
// the Exness terminal exposes into the groups we care about when choosing what
// to map into the bridge (dollar index, stock indices, oil, volatility, yields,
// and the instruments already mapped). Matching is by name pattern only - it
// never invents a symbol and never claims a match is the right instrument; the
// owner picks the real name from the list.

export type Mt5SymbolGroup = "dollarIndex" | "stockIndices" | "oil" | "volatility" | "yields" | "alreadyMapped";

const PATTERNS: Record<Exclude<Mt5SymbolGroup, "alreadyMapped">, RegExp> = {
  dollarIndex: /^(USDX|DXY|USDIDX|USIDX|DX)(\b|[._#-]|$)/i,
  stockIndices: /^(US500|SPX|SP500|USTEC|NAS100|NDX|US100|USTECH|US30|DJ30|DJI|WS30)(\b|[._#-]|$)/i,
  oil: /^(XTI|XBR|USOIL|UKOIL|WTI|BRENT|CL-|CL\b|BRN)/i,
  volatility: /^(VIX|VOLX|VXX)/i,
  yields: /^(US10Y|UST10|USTN10|TNOTE|US02Y|US30Y|BUND|BOND)/i,
};

const MAPPED = new Set(["XAUUSD", "XAGUSD", "EURUSD", "GBPUSD", "USDJPY", "BTCUSD", "ETHUSD"]);

export interface Mt5SymbolReport {
  count: number;
  groups: Record<Mt5SymbolGroup, string[]>;
}

export function groupMt5Symbols(names: readonly string[]): Mt5SymbolReport {
  const groups: Record<Mt5SymbolGroup, string[]> = { dollarIndex: [], stockIndices: [], oil: [], volatility: [], yields: [], alreadyMapped: [] };
  for (const name of names) {
    const upper = name.toUpperCase();
    // account suffixes like "XAUUSDm" / "EURUSD.a" still count as the mapped instrument
    const base = upper.replace(/[._#-].*$/, "").replace(/(M|C|Z|PRO|RAW)$/i, "");
    if (MAPPED.has(upper) || MAPPED.has(base)) groups.alreadyMapped.push(name);
    for (const key of Object.keys(PATTERNS) as (keyof typeof PATTERNS)[]) {
      if (PATTERNS[key].test(name)) groups[key].push(name);
    }
  }
  for (const k of Object.keys(groups) as Mt5SymbolGroup[]) groups[k].sort();
  return { count: names.length, groups };
}
