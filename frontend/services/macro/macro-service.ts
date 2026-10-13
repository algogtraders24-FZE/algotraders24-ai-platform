// services/macro/macro-service.ts
// Production entry point: live inputs -> Macro Alignment for one asset. Kept
// apart from the pure scorer and from the fetcher so each stays testable
// without network.

import { ASSET_PROFILES, computeMacroAlignment, type AssetId, type MacroAlignment } from "./macro-alignment";
import { fetchMacroInputs, loadMacroDataEnv, FRED_ATTRIBUTION, type FetchLike } from "./macro-data";

export interface MacroPrice {
  label: string;
  /** Ready-to-show, e.g. "$4,166.15" or "1.1178". */
  text: string;
  changePct: number;
}

export interface MacroAlignmentSnapshot {
  asset: AssetId;
  title: string;
  alignment: MacroAlignment;
  price: MacroPrice | null;
  fetchedAt: string;
  /** Shown only when a FRED-sourced driver actually contributed. */
  attribution: string | null;
}

const liveFetch: FetchLike = (url) => fetch(url, { cache: "no-store" });

export function formatMacroPrice(asset: AssetId, price: number): string {
  const p = ASSET_PROFILES[asset].price;
  return `${p.prefix}${price.toLocaleString("en-US", { minimumFractionDigits: p.decimals, maximumFractionDigits: p.decimals })}`;
}

export async function getMacroAlignmentSnapshot(asset: AssetId = "gold", f: FetchLike = liveFetch): Promise<MacroAlignmentSnapshot> {
  const profile = ASSET_PROFILES[asset];
  const data = await fetchMacroInputs(loadMacroDataEnv(), f, profile);
  const alignment = computeMacroAlignment(data.inputs, profile);
  const usedFred = alignment.drivers.some((d) => d.available && d.source.startsWith("FRED"));
  return {
    asset,
    title: profile.title,
    alignment,
    price: data.own ? { label: profile.price.label, text: formatMacroPrice(asset, data.own.price), changePct: data.own.changePct } : null,
    fetchedAt: data.fetchedAt,
    attribution: usedFred ? FRED_ATTRIBUTION : null,
  };
}
