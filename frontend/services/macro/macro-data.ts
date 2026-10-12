// services/macro/macro-data.ts
// Fetches the raw readings behind the Macro Alignment score (macro-alignment.ts).
//
//  - Gold momentum + dollar / Treasury / volatility proxies: Twelve Data `quote`
//    (percent_change). The dollar, Treasury and VIX drivers use ETFs as proxies
//    (UUP, IEF, VIXY) because the plan's index symbols are not served - the card
//    names the proxy, it never presents it as the index itself. VIXY decays, so
//    only its DAY CHANGE is used, never its level.
//  - Real yield: FRED series DFII10 (Board of Governors, public domain, citation
//    requested). Needs FRED_API_KEY; without it the driver is simply reported as
//    unavailable - never estimated.
//
// Every fetch is best-effort: a failed source yields value=null for that driver.
// Results are cached in-process for a few minutes (Twelve Data Basic = 8 req/min).

import type { MacroInputs, DriverInput } from "./macro-alignment";

export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface MacroDataEnv {
  twelveDataKey: string | null;
  fredKey: string | null;
}

export const FRED_ATTRIBUTION =
  "This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis. Real-yield data: Board of Governors of the Federal Reserve System (US), DFII10, retrieved from FRED, Federal Reserve Bank of St. Louis.";

export function loadMacroDataEnv(): MacroDataEnv {
  const td = process.env.TWELVEDATA_API_KEY?.trim();
  const fred = process.env.FRED_API_KEY?.trim();
  return { twelveDataKey: td ? td : null, fredKey: fred ? fred : null };
}

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { at: number; key: string; value: MacroFetchResult } | null = null;

export interface MacroFetchResult {
  inputs: MacroInputs;
  /** Latest gold quote (for the plain-language brief). */
  gold: { price: number; changePct: number } | null;
  fetchedAt: string;
}

const NA = (unit: string, source: string): DriverInput => ({ value: null, unit, source, asOf: null });

async function tdQuote(f: FetchLike, key: string, symbol: string): Promise<{ price: number | null; pct: number | null; asOf: string | null } | null> {
  try {
    const r = await f(`https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(key)}`);
    if (!r.ok) return null;
    const j = (await r.json()) as Record<string, unknown>;
    if (j.status === "error" || j.code) return null;
    const pct = Number(j.percent_change);
    const price = Number(j.close);
    const ts = Number(j.last_quote_at ?? j.timestamp);
    return {
      price: Number.isFinite(price) ? price : null,
      pct: Number.isFinite(pct) ? pct : null,
      asOf: Number.isFinite(ts) ? new Date(ts * 1000).toISOString() : null,
    };
  } catch {
    return null;
  }
}

/** Change in the latest DFII10 reading vs 5 observations earlier, in percentage points. */
async function fredRealYieldChange(f: FetchLike, key: string): Promise<{ change: number; asOf: string } | null> {
  try {
    const r = await f(
      `https://api.stlouisfed.org/fred/series/observations?series_id=DFII10&api_key=${encodeURIComponent(key)}&file_type=json&sort_order=desc&limit=10`,
    );
    if (!r.ok) return null;
    const j = (await r.json()) as { observations?: { date: string; value: string }[] };
    const obs = (j.observations ?? []).filter((o) => o.value !== "." && Number.isFinite(Number(o.value)));
    if (obs.length < 6) return null;
    return { change: Number(obs[0].value) - Number(obs[5].value), asOf: new Date(`${obs[0].date}T00:00:00Z`).toISOString() };
  } catch {
    return null;
  }
}

export async function fetchMacroInputs(env: MacroDataEnv, f: FetchLike, opts: { noCache?: boolean } = {}): Promise<MacroFetchResult> {
  const cacheKey = `${env.twelveDataKey ? 1 : 0}${env.fredKey ? 1 : 0}`;
  if (!opts.noCache && cache && cache.key === cacheKey && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;

  const [gold, uup, ief, vixy, real] = await Promise.all([
    env.twelveDataKey ? tdQuote(f, env.twelveDataKey, "XAU/USD") : null,
    env.twelveDataKey ? tdQuote(f, env.twelveDataKey, "UUP") : null,
    env.twelveDataKey ? tdQuote(f, env.twelveDataKey, "IEF") : null,
    env.twelveDataKey ? tdQuote(f, env.twelveDataKey, "VIXY") : null,
    env.fredKey ? fredRealYieldChange(f, env.fredKey) : null,
  ]);

  const inputs: MacroInputs = {
    realYield: real ? { value: real.change, unit: "pp over 5 days", source: "FRED DFII10", asOf: real.asOf } : NA("pp over 5 days", "FRED DFII10"),
    dollar: uup?.pct != null ? { value: uup.pct, unit: "% day change", source: "UUP (dollar proxy)", asOf: uup.asOf } : NA("% day change", "UUP (dollar proxy)"),
    yields: ief?.pct != null ? { value: ief.pct, unit: "% day change", source: "IEF (Treasury proxy)", asOf: ief.asOf } : NA("% day change", "IEF (Treasury proxy)"),
    riskSentiment: vixy?.pct != null ? { value: vixy.pct, unit: "% day change", source: "VIXY (volatility proxy)", asOf: vixy.asOf } : NA("% day change", "VIXY (volatility proxy)"),
    momentum: gold?.pct != null ? { value: gold.pct, unit: "% day change", source: "XAU/USD", asOf: gold.asOf } : NA("% day change", "XAU/USD"),
  };
  const result: MacroFetchResult = {
    inputs,
    gold: gold && gold.price != null && gold.pct != null ? { price: gold.price, changePct: gold.pct } : null,
    fetchedAt: new Date().toISOString(),
  };
  // Only cache a result that has something in it, so a transient outage is retried.
  if (Object.values(inputs).some((i) => i.value !== null)) cache = { at: Date.now(), key: cacheKey, value: result };
  return result;
}

export function resetMacroCacheForTests(): void {
  cache = null;
}
