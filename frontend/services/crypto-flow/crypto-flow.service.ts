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

// ---- derivatives positioning ----
import type { CryptoFlowDerivativesDetail, CryptoFlowDerivativesOverview } from "@/types/crypto-flow";
import { CRYPTO_FLOW_SYMBOLS } from "@/types/crypto-flow";
import { fetchFundingInfo, fetchGlobalRatio, fetchOpenInterestHist, fetchPremiumIndexAll, fetchTakerRatio, fetchTopRatio } from "./binance.provider";
import { fundingRows, latestRatio, latestTakerRatio, oiWindow, parseOiHistory, type RawOiPoint, type RawPremium, type RawRatioPoint } from "./derivatives";

async function fundingIntervals(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    for (const r of (await fetchFundingInfo()) as Array<{ symbol?: unknown; fundingIntervalHours?: unknown }>) {
      const h = Number(r.fundingIntervalHours);
      if (typeof r.symbol === "string" && Number.isFinite(h) && h > 0) map.set(r.symbol, h);
    }
  } catch {
    /* default to 8 hours */
  }
  return map;
}

/** Funding for every Crypto Flow instrument that has a USDS-M perpetual. */
export async function getDerivativesOverview(): Promise<CryptoFlowDerivativesOverview> {
  const [premium, intervals] = await Promise.all([fetchPremiumIndexAll(), fundingIntervals()]);
  return { rows: fundingRows(premium as RawPremium[], intervals, CRYPTO_FLOW_SYMBOLS) };
}

/** Funding, open interest and long/short crowding for one instrument. Null when it has no perpetual. */
export async function getDerivativesDetail(symbol: string): Promise<CryptoFlowDerivativesDetail | null> {
  if (!getCryptoFlowInstrument(symbol)) throw new CryptoFlowProviderError("invalid_response", "Unknown instrument");
  const [premium, intervals, oi, acc, top, taker] = await Promise.all([
    fetchPremiumIndexAll(),
    fundingIntervals(),
    fetchOpenInterestHist(symbol),
    fetchGlobalRatio(symbol).catch(() => []),
    fetchTopRatio(symbol).catch(() => []),
    fetchTakerRatio(symbol).catch(() => []),
  ]);
  const funding = fundingRows(premium as RawPremium[], intervals, [symbol])[0];
  const series = parseOiHistory(oi as RawOiPoint[]);
  const h4 = oiWindow(series, 4);
  const h24 = oiWindow(series, 24);
  if (!funding || !h4 || !h24) return null;
  const last = series[series.length - 1];
  return {
    symbol,
    asOf: last.t,
    funding,
    openInterest: last.oi,
    openInterestUsd: last.value,
    h4,
    h24,
    accounts: latestRatio(acc as RawRatioPoint[]),
    topTraders: latestRatio(top as RawRatioPoint[]),
    takerRatio1h: latestTakerRatio(taker as Array<{ buySellRatio?: unknown }>),
  };
}
