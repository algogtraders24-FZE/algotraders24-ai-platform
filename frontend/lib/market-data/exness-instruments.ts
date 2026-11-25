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

const SAFE_SYMBOL = /^[A-Z0-9._#-]{3,24}$/;
const MAX_UNLISTED_REGISTRATIONS = 300;
let unlistedRegistered = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Makes an Exness-listed symbol chartable. Returns false when Exness does not list it.
 * Serverless instances keep their own list cache and the Exness API can answer slowly or refuse for a moment, so an empty list is retried once; if the
 * list is still unavailable the symbol (when it looks like a plain instrument id) is registered from its own name and the candles call decides: a wrong
 * symbol then fails there with a clear "unavailable" message instead of every pair failing at once.
 */
export async function ensureExnessInstrumentRegistered(symbolRaw: string): Promise<boolean> {
  const symbol = symbolRaw.toUpperCase();
  if (getCanonicalInstrument(symbol)) return true;
  let list = await listExnessInstruments();
  if (list.length === 0) {
    await sleep(700);
    list = await listExnessInstruments();
  }
  if (list.length === 0) {
    if (!SAFE_SYMBOL.test(symbol) || unlistedRegistered >= MAX_UNLISTED_REGISTRATIONS || !getSharedExnessClient().isEnabled()) return false;
    unlistedRegistered += 1;
    registerDiscoveredInstrument(buildExnessCanonical(toExnessDto(symbol)));
    return true;
  }
  const entry = list.find((i) => i.symbol === symbol);
  if (!entry) return false;
  registerDiscoveredInstrument(buildExnessCanonical(entry));
  return true;
}
