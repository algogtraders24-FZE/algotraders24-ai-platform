// services/macro/macro-service.ts
// Production entry point: live inputs -> Macro Alignment. Kept apart from the
// pure scorer and from the fetcher so each stays testable without network.

import { computeMacroAlignment, type MacroAlignment } from "./macro-alignment";
import { fetchMacroInputs, loadMacroDataEnv, FRED_ATTRIBUTION, type FetchLike, type MacroFetchResult } from "./macro-data";

export interface MacroAlignmentSnapshot {
  symbol: "XAUUSD";
  alignment: MacroAlignment;
  gold: MacroFetchResult["gold"];
  fetchedAt: string;
  /** Shown only when the FRED-sourced driver actually contributed. */
  attribution: string | null;
}

const liveFetch: FetchLike = (url) => fetch(url, { cache: "no-store" });

export async function getMacroAlignmentSnapshot(f: FetchLike = liveFetch): Promise<MacroAlignmentSnapshot> {
  const data = await fetchMacroInputs(loadMacroDataEnv(), f);
  const alignment = computeMacroAlignment(data.inputs);
  const usedFred = alignment.drivers.some((d) => d.id === "realYield" && d.available);
  return { symbol: "XAUUSD", alignment, gold: data.gold, fetchedAt: data.fetchedAt, attribution: usedFred ? FRED_ATTRIBUTION : null };
}
