// lib/research/binance-historical-trades.ts
// Sprint D2.8.14 - Historical Microstructure Outcome Validation. A NEW,
// isolated, research-only capability - deliberately NOT added to the
// production lib/market-data/providers/binance.provider.ts (that file's
// getMicrostructureSnapshot() stays byte-identical; it only ever calls
// /depth and /trades, the live-only endpoints).
//
// Binance's public REST API has NO historical order-book depth endpoint at
// any tier (Phase 1 finding - see the D2.8.14 spec doc's data-availability
// table). GET /api/v3/aggTrades DOES accept real startTime/endTime and
// genuinely returns real historical aggregated trades with an aggressor
// flag (`m`: true means the buyer was the maker, i.e. the SELL side was
// the taker/aggressor - the same Binance-documented meaning
// binance.provider.ts's own getMicrostructureSnapshot() already relies on
// for live trades, reused verbatim here, never reinterpreted). This lets
// this research compute a REAL historical volume delta - it can NEVER
// reconstruct historical order-book depth/imbalance, which is structurally
// unavailable and must remain "not_supported_by_provider", never guessed
// from OHLC candles.
const BASE_URL = "https://api.binance.com/api/v3";
const PROVIDER_NAME = "binance";

export interface BinanceHistoricalAggTrade {
  price: number;
  quantity: number;
  timestamp: string;
  /** Derived from Binance's own `m` (isBuyerMaker) flag - never guessed. */
  aggressorSide: "buy" | "sell";
}

interface RawAggTrade {
  a: number;
  p: string;
  q: string;
  T: number;
  m: boolean;
}

export class BinanceHistoricalTradesError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "BinanceHistoricalTradesError";
  }
}

/**
 * Fetches REAL historical aggregated trades for one Binance symbol within
 * [startMs, endMs] (inclusive of startMs, per Binance's own documented
 * semantics). Never called with an endMs beyond the caller's own "now" -
 * enforced by the caller (the dataset builder), not here, so this function
 * stays a pure, reusable network primitive. Binance caps a single response
 * at 1000 trades; a window with more real trades than that is honestly
 * reported as `truncated: true` rather than silently returning a partial
 * sample as if it were complete.
 */
export async function fetchBinanceHistoricalAggTrades(
  binanceSymbol: string,
  startMs: number,
  endMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<{ trades: BinanceHistoricalAggTrade[]; truncated: boolean }> {
  const url = `${BASE_URL}/aggTrades?symbol=${encodeURIComponent(binanceSymbol)}&startTime=${startMs}&endTime=${endMs}&limit=1000`;
  let res: Response;
  try {
    res = await fetchImpl(url);
  } catch (cause) {
    throw new BinanceHistoricalTradesError(`Failed to reach Binance for historical aggTrades (${binanceSymbol})`, cause);
  }

  let body: RawAggTrade[] | { code: number; msg: string };
  try {
    body = (await res.json()) as RawAggTrade[] | { code: number; msg: string };
  } catch (cause) {
    throw new BinanceHistoricalTradesError("Binance historical aggTrades response was not valid JSON", cause);
  }

  if (!res.ok || !Array.isArray(body)) {
    const msg = !Array.isArray(body) && "msg" in body ? body.msg : `HTTP ${res.status}`;
    throw new BinanceHistoricalTradesError(`Binance aggTrades request failed for ${binanceSymbol}: ${msg}`);
  }

  const trades: BinanceHistoricalAggTrade[] = [];
  for (const raw of body) {
    const price = Number.parseFloat(raw.p);
    const quantity = Number.parseFloat(raw.q);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(quantity) || quantity < 0) continue; // malformed row dropped, never fabricated
    trades.push({
      price,
      quantity,
      timestamp: new Date(raw.T).toISOString(),
      aggressorSide: raw.m ? "sell" : "buy",
    });
  }

  return { trades, truncated: body.length >= 1000 };
}

export { PROVIDER_NAME as BINANCE_HISTORICAL_PROVIDER_NAME };
