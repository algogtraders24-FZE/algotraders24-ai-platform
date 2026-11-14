// services/crypto-flow/crypto-flow.service.ts
// Reads the Binance klines through the provider and shapes them with the pure maths in compute.ts.
import "server-only";
import { CRYPTO_FLOW_INSTRUMENTS, getCryptoFlowInstrument, getCryptoFlowLookback, type CryptoFlowZones, type CryptoFlowOverview, type CryptoFlowOverviewRow, type CryptoFlowResponse } from "@/types/crypto-flow";
import { CryptoFlowProviderError, fetchBinanceDepth, fetchBinanceKlines } from "./binance.provider";
import { computeCryptoFlow } from "./compute";
import { computeFlowZones, type RawBook } from "./zones";

/** One instrument, with the 4-hour series (detail view). Throws CryptoFlowProviderError when the feed fails. */
export async function getCryptoFlow(symbol: string, withSeries = true): Promise<CryptoFlowResponse> {
  const instrument = getCryptoFlowInstrument(symbol);
  if (!instrument) throw new CryptoFlowProviderError("invalid_response", "Unknown instrument");
  const rows = await fetchBinanceKlines(instrument.symbol, instrument.market);
  const venue = instrument.market === "perp" ? "Binance USDS-M perpetual" : "Binance spot";
  const result = computeCryptoFlow(instrument.symbol, rows, Date.now(), venue, withSeries);
  if (!result) throw new CryptoFlowProviderError("invalid_response", "Not enough closed minutes returned");
  return result;
}

/** All instruments in parallel (no series). An instrument whose feed fails shows as unavailable; the others still load. */
export async function getCryptoFlowOverview(): Promise<CryptoFlowOverview> {
  const settled = await Promise.allSettled(CRYPTO_FLOW_INSTRUMENTS.map((i) => getCryptoFlow(i.symbol, false)));
  const rows: CryptoFlowOverviewRow[] = settled.map((r, idx) => {
    const symbol = CRYPTO_FLOW_INSTRUMENTS[idx].symbol;
    if (r.status === "fulfilled") return { symbol, status: "ok", data: r.value };
    return { symbol, status: "unavailable", message: "Temporarily unavailable" };
  });
  return { rows };
}

/** Flow Zones for one instrument and lookback. The order book is optional: when it cannot be loaded the zones still return, without walls. */
export async function getCryptoFlowZones(symbol: string, lookback: string): Promise<CryptoFlowZones> {
  const instrument = getCryptoFlowInstrument(symbol);
  const cfg = getCryptoFlowLookback(lookback);
  if (!instrument || !cfg) throw new CryptoFlowProviderError("invalid_response", "Unknown instrument or lookback");
  const [klines, book] = await Promise.all([
    fetchBinanceKlines(instrument.symbol, instrument.market, fetch, cfg.interval, cfg.bars + 1),
    fetchBinanceDepth(instrument.symbol, instrument.market).catch((): RawBook | null => null),
  ]);
  const venue = instrument.market === "perp" ? "Binance USDS-M perpetual" : "Binance spot";
  const result = computeFlowZones(instrument.symbol, klines, book, Date.now(), venue, cfg);
  if (!result) throw new CryptoFlowProviderError("invalid_response", "Not enough closed bars returned");
  return result;
}
