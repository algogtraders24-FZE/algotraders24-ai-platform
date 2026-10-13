// services/macro/macro-data.ts
// Fetches the raw readings behind the Macro Alignment score (macro-alignment.ts)
// for one asset profile.
//
//  - Asset price/momentum and the dollar / Treasury / equity / volatility
//    drivers: Twelve Data `quote` (percent_change). The dollar, Treasury, stock
//    and VIX drivers use ETFs as proxies (UUP, IEF, QQQ, VIXY) because the plan's
//    index symbols are not served - the card names the proxy, it never presents
//    it as the index itself. VIXY decays, so only its DAY CHANGE is used, never
//    its level. Crude oil uses USO (a WTI futures ETF) - a proxy, not spot WTI.
//  - Real yield / US 10Y yield: FRED series DFII10 / DGS10 (Board of Governors
//    H.15, public domain, citation requested). Needs FRED_API_KEY; without it
//    those drivers are simply reported as unavailable - never estimated.
//
// Every fetch is best-effort: a failed source yields value=null for that driver.
// Quotes are cached in-process 5 minutes per symbol and FRED series 30 minutes
// (Twelve Data Basic = 8 req/min; switching asset reuses the shared quotes).

import type { AssetProfile, DriverId, DriverInput, MacroInputs } from "./macro-alignment";

export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface MacroDataEnv {
  twelveDataKey: string | null;
  fredKey: string | null;
}

export const FRED_ATTRIBUTION =
  "This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis. Yield data: Board of Governors of the Federal Reserve System (US), retrieved from FRED, Federal Reserve Bank of St. Louis.";

export function loadMacroDataEnv(): MacroDataEnv {
  const td = process.env.TWELVEDATA_API_KEY?.trim();
  const fred = process.env.FRED_API_KEY?.trim();
  return { twelveDataKey: td ? td : null, fredKey: fred ? fred : null };
}

const QUOTE_TTL_MS = 5 * 60 * 1000;
const FRED_TTL_MS = 30 * 60 * 1000;

interface Quote {
  price: number | null;
  pct: number | null;
  asOf: string | null;
}
interface FredChange {
  change: number;
  asOf: string;
}

/** A failed fetch is remembered only briefly so an outage heals quickly but a rate-limited key is not hammered. */
const FAILURE_TTL_MS = 60 * 1000;
const quoteCache = new Map<string, { at: number; ttl: number; value: Quote | null }>();
const fredCache = new Map<string, { at: number; ttl: number; value: FredChange | null }>();

export interface MacroFetchResult {
  inputs: MacroInputs;
  /** The asset's own latest quote, for the price line. */
  own: { price: number; changePct: number } | null;
  fetchedAt: string;
}

/** Twelve Data symbol behind each quote-based driver (momentum uses the profile's own quote). */
const QUOTE_DRIVERS: Partial<Record<DriverId, { symbol: string; source: string }>> = {
  dollar: { symbol: "UUP", source: "UUP (dollar proxy)" },
  yields: { symbol: "IEF", source: "IEF (Treasury proxy)" },
  riskAppetite: { symbol: "QQQ", source: "QQQ (stock-market proxy)" },
  riskSentiment: { symbol: "VIXY", source: "VIXY (volatility proxy)" },
};
const FRED_DRIVERS: Partial<Record<DriverId, { series: string; source: string }>> = {
  realYield: { series: "DFII10", source: "FRED DFII10" },
  nominalYield: { series: "DGS10", source: "FRED DGS10" },
};

async function tdQuote(f: FetchLike, key: string, symbol: string, noCache: boolean): Promise<Quote | null> {
  const hit = quoteCache.get(symbol);
  if (!noCache && hit && Date.now() - hit.at < hit.ttl) return hit.value;
  let value: Quote | null = null;
  try {
    const r = await f(`https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(key)}`);
    if (r.ok) {
      const j = (await r.json()) as Record<string, unknown>;
      if (j.status !== "error" && !j.code) {
        const pct = Number(j.percent_change);
        const price = Number(j.close);
        const ts = Number(j.last_quote_at ?? j.timestamp);
        value = {
          price: Number.isFinite(price) ? price : null,
          pct: Number.isFinite(pct) ? pct : null,
          asOf: Number.isFinite(ts) ? new Date(ts * 1000).toISOString() : null,
        };
      }
    }
  } catch {
    value = null;
  }
  if (!noCache) quoteCache.set(symbol, { at: Date.now(), ttl: value ? QUOTE_TTL_MS : FAILURE_TTL_MS, value });
  return value;
}

/** Change in the latest FRED observation vs 5 observations earlier, in percentage points. */
async function fredChange(f: FetchLike, key: string, series: string, noCache: boolean): Promise<FredChange | null> {
  const hit = fredCache.get(series);
  if (!noCache && hit && Date.now() - hit.at < hit.ttl) return hit.value;
  let value: FredChange | null = null;
  try {
    const r = await f(
      `https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(series)}&api_key=${encodeURIComponent(key)}&file_type=json&sort_order=desc&limit=10`,
    );
    if (r.ok) {
      const j = (await r.json()) as { observations?: { date: string; value: string }[] };
      const obs = (j.observations ?? []).filter((o) => o.value !== "." && Number.isFinite(Number(o.value)));
      if (obs.length >= 6) value = { change: Number(obs[0].value) - Number(obs[5].value), asOf: new Date(`${obs[0].date}T00:00:00Z`).toISOString() };
    }
  } catch {
    value = null;
  }
  if (!noCache) fredCache.set(series, { at: Date.now(), ttl: value ? FRED_TTL_MS : FAILURE_TTL_MS, value });
  return value;
}

const NA = (unit: string, source: string): DriverInput => ({ value: null, unit, source, asOf: null });

export async function fetchMacroInputs(env: MacroDataEnv, f: FetchLike, profile: AssetProfile, opts: { noCache?: boolean } = {}): Promise<MacroFetchResult> {
  const noCache = opts.noCache === true;
  const ids = new Set<DriverId>(profile.drivers.map((d) => d.id));
  const td = env.twelveDataKey;

  const need: Promise<void>[] = [];
  const inputs: MacroInputs = {};
  let own: Quote | null = null;

  const needsOwn = ids.has("momentum");
  if (needsOwn) {
    need.push(
      (td ? tdQuote(f, td, profile.ownQuote.symbol, noCache) : Promise.resolve(null)).then((q) => {
        own = q;
        inputs.momentum = q?.pct != null ? { value: q.pct, unit: "% day change", source: profile.ownQuote.source, asOf: q.asOf } : NA("% day change", profile.ownQuote.source);
      }),
    );
  }
  for (const [id, cfg] of Object.entries(QUOTE_DRIVERS) as [DriverId, { symbol: string; source: string }][]) {
    if (!ids.has(id)) continue;
    need.push(
      (td ? tdQuote(f, td, cfg.symbol, noCache) : Promise.resolve(null)).then((q) => {
        inputs[id] = q?.pct != null ? { value: q.pct, unit: "% day change", source: cfg.source, asOf: q.asOf } : NA("% day change", cfg.source);
      }),
    );
  }
  for (const [id, cfg] of Object.entries(FRED_DRIVERS) as [DriverId, { series: string; source: string }][]) {
    if (!ids.has(id)) continue;
    need.push(
      (env.fredKey ? fredChange(f, env.fredKey, cfg.series, noCache) : Promise.resolve(null)).then((c) => {
        inputs[id] = c ? { value: c.change, unit: "pp over 5 days", source: cfg.source, asOf: c.asOf } : NA("pp over 5 days", cfg.source);
      }),
    );
  }
  await Promise.all(need);

  const ownQuote = own as Quote | null;
  return {
    inputs,
    own: ownQuote && ownQuote.price != null && ownQuote.pct != null ? { price: ownQuote.price, changePct: ownQuote.pct } : null,
    fetchedAt: new Date().toISOString(),
  };
}

export function resetMacroCacheForTests(): void {
  quoteCache.clear();
  fredCache.clear();
}
