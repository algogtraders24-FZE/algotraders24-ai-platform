// services/macro/macro-data.ts
// Fetches the raw readings behind the Macro Alignment score (macro-alignment.ts)
// for one asset profile.
//
// Source order, per reading:
//  1. The Exness MT5 terminal via our own read-only bridge (mt5-bridge): the
//     asset's own price + day change (daily candles: now vs the previous close),
//     the US dollar index (DXY), the Nasdaq-100 (USTEC) and WTI crude (USOIL).
//     Real instruments, no rate limit, and the same feed the Signals page shows.
//  2. Twelve Data `quote` as the fallback when the bridge is not configured, the
//     symbol is not mapped on it yet, or it is down - using ETF proxies (UUP,
//     QQQ, USO, SLV) where the plan has no index/spot symbol. The card names the
//     source of every reading, so a proxy is never presented as the real thing.
//  3. Always Twelve Data (no MT5 equivalent on the account): IEF (Treasuries).
//     Risk barometer = AUD/JPY from MT5 only (the account has no VIX).
//  4. FRED series DFII10 / DGS10 (Board of Governors H.15, public domain,
//     citation requested) for real yield / US 10Y. Needs FRED_API_KEY.
//
// Every fetch is best-effort: a failed source yields value=null for that driver -
// never an estimate. Quotes are cached in-process (MT5 60s, Twelve Data 5 min),
// FRED 30 min; a failed fetch is remembered 60s. Twelve Data Basic = 8 req/min,
// which is why the MT5 feed carries everything it can.

import type { AssetProfile, DriverId, DriverInput, MacroInputs } from "./macro-alignment";

export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface MacroDataEnv {
  twelveDataKey: string | null;
  fredKey: string | null;
  /** The MT5 bridge, when configured. */
  mt5?: { bridgeUrl: string; secret: string } | null;
}

export const FRED_ATTRIBUTION =
  "This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis. Yield data: Board of Governors of the Federal Reserve System (US), retrieved from FRED, Federal Reserve Bank of St. Louis.";

export function loadMacroDataEnv(): MacroDataEnv {
  const td = process.env.TWELVEDATA_API_KEY?.trim();
  const fred = process.env.FRED_API_KEY?.trim();
  const url = process.env.MT5_BRIDGE_URL?.trim();
  const secret = process.env.MT5_BRIDGE_SECRET?.trim();
  return {
    twelveDataKey: td ? td : null,
    fredKey: fred ? fred : null,
    mt5: url && secret ? { bridgeUrl: url.replace(/\/+$/, ""), secret } : null,
  };
}

const MT5_TTL_MS = 60 * 1000;
/** An MT5 reading whose last daily candle is older than this is stale (the terminal can serve old history for a symbol it has not synced yet - AUDJPY showed a candle from a year ago). Long enough for a weekend plus a holiday. */
export const MT5_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000;
const TD_TTL_MS = 5 * 60 * 1000;
const FRED_TTL_MS = 30 * 60 * 1000;
/** A failed fetch is remembered only briefly so an outage heals quickly but a rate-limited key is not hammered. */
const FAILURE_TTL_MS = 60 * 1000;

interface Quote {
  price: number | null;
  pct: number | null;
  asOf: string | null;
}
interface FredChange {
  change: number;
  asOf: string;
}

const quoteCache = new Map<string, { at: number; ttl: number; value: Quote | null }>();
const fredCache = new Map<string, { at: number; ttl: number; value: FredChange | null }>();

export type QuoteProvider = "mt5" | "twelve-data";

export interface MacroFetchResult {
  inputs: MacroInputs;
  /** The asset's own latest quote, for the price line, and which feed it came from. */
  own: { price: number; changePct: number; provider: QuoteProvider } | null;
  fetchedAt: string;
}

/** Drivers fed by a quote. `mt5` = the Exness symbol tried first; `td` = Twelve Data symbol (fallback, or the only source). */
const QUOTE_DRIVERS: Partial<Record<DriverId, { td?: { symbol: string; source: string }; mt5?: { symbol: string; source: string } }>> = {
  dollar: { td: { symbol: "UUP", source: "UUP (dollar proxy)" }, mt5: { symbol: "DXY", source: "DXY (US dollar index, Exness)" } },
  yields: { td: { symbol: "IEF", source: "IEF (Treasury proxy)" } },
  riskAppetite: { td: { symbol: "QQQ", source: "QQQ (stock-market proxy)" }, mt5: { symbol: "USTEC", source: "USTEC (Nasdaq-100, Exness)" } },
  // No VIX on the Exness account. AUD/JPY is the classic risk barometer (it falls when risk is taken off) and, unlike a
  // volatility ETF, does not decay. MT5 only: when the bridge cannot serve it the driver is "not available", never estimated.
  riskBarometer: { mt5: { symbol: "AUDJPY", source: "AUDJPY (risk barometer, Exness)" } },
};
const FRED_DRIVERS: Partial<Record<DriverId, { series: string; source: string }>> = {
  realYield: { series: "DFII10", source: "FRED DFII10" },
  nominalYield: { series: "DGS10", source: "FRED DGS10" },
};

async function tdQuote(f: FetchLike, key: string, symbol: string, noCache: boolean): Promise<Quote | null> {
  const ck = `td:${symbol}`;
  const hit = quoteCache.get(ck);
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
  if (!noCache) quoteCache.set(ck, { at: Date.now(), ttl: value ? TD_TTL_MS : FAILURE_TTL_MS, value });
  return value;
}

/** Price now + change vs the previous daily close, from the bridge's 1d candles (the last candle is the forming day). */
async function mt5Quote(f: FetchLike, mt5: { bridgeUrl: string; secret: string }, symbol: string, noCache: boolean): Promise<Quote | null> {
  const ck = `mt5:${symbol}`;
  const hit = quoteCache.get(ck);
  if (!noCache && hit && Date.now() - hit.at < hit.ttl) return hit.value;
  let value: Quote | null = null;
  try {
    const r = await f(`${mt5.bridgeUrl}/candles?symbol=${encodeURIComponent(symbol)}&interval=1d&count=2`, {
      headers: { Authorization: `Bearer ${mt5.secret}` },
    });
    if (r.ok) {
      const j = (await r.json()) as { candles?: { datetime?: string; close?: number }[] };
      const rows = (j.candles ?? []).filter((c) => typeof c.close === "number" && Number.isFinite(c.close));
      const last = rows[rows.length - 1];
      const prev = rows.length >= 2 ? rows[rows.length - 2] : undefined;
      if (last && typeof last.close === "number") {
        const pct = prev && typeof prev.close === "number" && prev.close !== 0 ? ((last.close - prev.close) / prev.close) * 100 : null;
        const t = last.datetime ? new Date(last.datetime).getTime() : NaN;
        // No candle time, or one that is too old, means we cannot vouch the reading is current: treat it as unavailable.
        if (Number.isFinite(t) && Date.now() - t <= MT5_MAX_AGE_MS) {
          value = { price: last.close, pct, asOf: new Date(t).toISOString() };
        }
      }
    }
  } catch {
    value = null;
  }
  if (!noCache) quoteCache.set(ck, { at: Date.now(), ttl: value ? MT5_TTL_MS : FAILURE_TTL_MS, value });
  return value;
}

/** MT5 first (when a symbol and the bridge are available and it gave a day change), Twelve Data otherwise. */
async function resolveQuote(
  f: FetchLike,
  env: MacroDataEnv,
  want: { mt5?: { symbol: string; source: string }; td?: { symbol: string; source: string } },
  noCache: boolean,
): Promise<{ q: Quote | null; source: string; provider: QuoteProvider } | null> {
  if (want.mt5 && env.mt5) {
    const q = await mt5Quote(f, env.mt5, want.mt5.symbol, noCache);
    if (q && q.pct !== null) return { q, source: want.mt5.source, provider: "mt5" };
  }
  if (want.td && env.twelveDataKey) {
    const q = await tdQuote(f, env.twelveDataKey, want.td.symbol, noCache);
    return { q, source: want.td.source, provider: "twelve-data" };
  }
  if (want.td) return { q: null, source: want.td.source, provider: "twelve-data" };
  return want.mt5 ? { q: null, source: want.mt5.source, provider: "mt5" } : null;
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

  const need: Promise<void>[] = [];
  const inputs: MacroInputs = {};
  let own: { q: Quote | null; provider: QuoteProvider } | null = null;

  if (ids.has("momentum")) {
    const oq = profile.ownQuote;
    need.push(
      resolveQuote(
        f,
        env,
        {
          mt5: oq.mt5 ? { symbol: oq.mt5, source: `${oq.mt5} (Exness)` } : undefined,
          td: oq.symbol ? { symbol: oq.symbol, source: oq.source } : undefined,
        },
        noCache,
      ).then((r) => {
        own = r ? { q: r.q, provider: r.provider } : null;
        const src = r?.source ?? oq.source;
        inputs.momentum = r?.q?.pct != null ? { value: r.q.pct, unit: "% day change", source: src, asOf: r.q.asOf } : NA("% day change", src);
      }),
    );
  }
  for (const [id, cfg] of Object.entries(QUOTE_DRIVERS) as [DriverId, NonNullable<(typeof QUOTE_DRIVERS)[DriverId]>][]) {
    if (!ids.has(id)) continue;
    const mt5 = id === "riskAppetite" && profile.riskIndex ? { symbol: profile.riskIndex.mt5, source: profile.riskIndex.source } : cfg.mt5;
    need.push(
      resolveQuote(f, env, { mt5, td: cfg.td }, noCache).then((r) => {
        const src = r?.source ?? cfg.td?.source ?? mt5?.source ?? "";
        inputs[id] = r?.q?.pct != null ? { value: r.q.pct, unit: "% day change", source: src, asOf: r.q.asOf } : NA("% day change", src);
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

  const o = own as { q: Quote | null; provider: QuoteProvider } | null;
  return {
    inputs,
    own: o?.q && o.q.price != null && o.q.pct != null ? { price: o.q.price, changePct: o.q.pct, provider: o.provider } : null,
    fetchedAt: new Date().toISOString(),
  };
}

export function resetMacroCacheForTests(): void {
  quoteCache.clear();
  fredCache.clear();
}
