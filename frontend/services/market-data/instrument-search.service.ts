// services/market-data/instrument-search.service.ts
// Sprint D2.6.3 - Global Instrument Discovery & Intelligent Multi-Provider
// Data Fabric. Pure, synchronous, deterministic search over the real
// instrument catalog (lib/market-data/instrument-catalog.ts) - no LLM,
// no fuzzy/semantic matching, no network. The same query against the
// same catalog always returns the same ranked list, in the same order.
//
// Ranking (sprint §6, checked in this exact precedence order per
// candidate instrument - the BEST match type found wins, never the
// first one checked): exact canonical symbol > exact provider symbol >
// exact display name > exact alias > prefix symbol match > prefix name
// match > substring match. Ambiguity is never silently resolved to one
// result: every matching instrument is returned, ranked.
import type { CanonicalInstrument } from "@/types/canonical-instrument";
import { listCanonicalInstruments } from "@/lib/market-data/instrument-catalog";

export type InstrumentMatchType =
  | "exact-canonical"
  | "exact-provider-symbol"
  | "exact-display-name"
  | "exact-alias"
  | "prefix-symbol"
  | "prefix-name"
  | "substring";

// Lower = ranked first. Fixed, documented, never per-call configurable -
// a deterministic policy, not a tunable relevance score.
const MATCH_RANK: Record<InstrumentMatchType, number> = {
  "exact-canonical": 0,
  "exact-provider-symbol": 1,
  "exact-display-name": 2,
  "exact-alias": 3,
  "prefix-symbol": 4,
  "prefix-name": 5,
  substring: 6,
};

export interface InstrumentSearchResult {
  instrument: CanonicalInstrument;
  matchType: InstrumentMatchType;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/** The BEST (lowest-rank) match type for this instrument against the query, or undefined if it doesn't match at all. */
function classify(instrument: CanonicalInstrument, q: string): InstrumentMatchType | undefined {
  const canonical = normalize(instrument.id);
  const symbolCompact = normalize(instrument.symbol).replace(/\//g, "");
  const displayName = normalize(instrument.displayName);
  const aliases = instrument.aliases.map(normalize);
  const providerSymbols = instrument.providerMappings.map((m) => normalize(m.providerSymbol));

  if (canonical === q) return "exact-canonical";
  if (providerSymbols.includes(q)) return "exact-provider-symbol";
  if (displayName === q) return "exact-display-name";
  if (aliases.includes(q)) return "exact-alias";
  if (canonical.startsWith(q) || symbolCompact.startsWith(q)) return "prefix-symbol";
  if (displayName.startsWith(q) || aliases.some((a) => a.startsWith(q))) return "prefix-name";
  if (canonical.includes(q) || displayName.includes(q) || aliases.some((a) => a.includes(q)) || providerSymbols.some((s) => s.includes(q))) {
    return "substring";
  }
  return undefined;
}

const DEFAULT_LIMIT = 20;

export class InstrumentSearchService {
  /**
   * Deterministic ranked search. Empty/whitespace-only query returns []
   * (never "everything") - a caller must supply real search intent.
   * Ties within the same match type break on canonical `id` alphabetical
   * order, so the result order is fully reproducible.
   */
  search(rawQuery: string, limit: number = DEFAULT_LIMIT): InstrumentSearchResult[] {
    const q = normalize(rawQuery);
    if (!q) return [];

    const results: InstrumentSearchResult[] = [];
    for (const instrument of listCanonicalInstruments()) {
      const matchType = classify(instrument, q);
      if (matchType) results.push({ instrument, matchType });
    }

    results.sort((a, b) => {
      const rankDiff = MATCH_RANK[a.matchType] - MATCH_RANK[b.matchType];
      if (rankDiff !== 0) return rankDiff;
      return a.instrument.id.localeCompare(b.instrument.id);
    });

    return results.slice(0, limit);
  }
}
