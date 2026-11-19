// lib/market-data/exness-instruments.ts  (server only)
// The instruments the Exness account serves, read from the Exness Trading API (read-only, never hand-typed),
// and registration of any of them with the canonical catalog so the chart can load their candles.
import { getSharedExnessClient, type ExnessInstrumentInfo } from "./exness-api";
import { getCanonicalInstrument, registerDiscoveredInstrument } from "./instrument-catalog";
import { buildExnessCanonical, toExnessDto, type ExnessInstrumentDto } from "./exness-instrument-model";

const LIST_TTL_MS = 6 * 60 * 60 * 1000;
let listCache: { at: number; list: ExnessInstrumentDto[] } | null = null;

/** Every instrument the Exness account lists, grouped. Empty array when the Exness API is not enabled or fails (callers fall back). */
export async function listExnessInstruments(): Promise<ExnessInstrumentDto[]> {
  const client = getSharedExnessClient();
  if (!client.isEnabled()) return [];
  if (listCache && Date.now() - listCache.at < LIST_TTL_MS) return listCache.list;
  let raw: ExnessInstrumentInfo[];
  try {
    raw = await client.listInstruments();
  } catch {
    return listCache?.list ?? [];
  }
  const seen = new Set<string>();
  const list: ExnessInstrumentDto[] = [];
  for (const r of raw) {
    const dto = toExnessDto(r.symbol, r.description);
    if (seen.has(dto.symbol)) continue;
    seen.add(dto.symbol);
    list.push(dto);
  }
  list.sort((a, b) => a.group.localeCompare(b.group) || a.symbol.localeCompare(b.symbol));
  listCache = { at: Date.now(), list };
  return list;
}

/** Makes an Exness-listed symbol chartable. Returns false when Exness does not list it. */
export async function ensureExnessInstrumentRegistered(symbolRaw: string): Promise<boolean> {
  const symbol = symbolRaw.toUpperCase();
  if (getCanonicalInstrument(symbol)) return true;
  const entry = (await listExnessInstruments()).find((i) => i.symbol === symbol);
  if (!entry) return false;
  registerDiscoveredInstrument(buildExnessCanonical(entry));
  return true;
}
