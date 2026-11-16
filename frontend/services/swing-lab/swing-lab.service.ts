// services/swing-lab/swing-lab.service.ts
// Reads daily and 4-hour Binance klines (the same public market-data hosts as Crypto Flow) and builds the swing map rows.
import "server-only";
import { CRYPTO_FLOW_INSTRUMENTS } from "@/types/crypto-flow";
import type { SwingMapOverview, SwingMapOverviewRow } from "@/types/swing-lab";
import { CryptoFlowProviderError, fetchBinanceKlines } from "@/services/crypto-flow/binance.provider";
import { computeSwingMap } from "./compute";

/** 400 daily bars (57 complete weeks, enough for SMA(50) on weekly bars) and 220 four-hour bars; the last bar of each is still open. */
const DAILY_LIMIT = 401;
const H4_LIMIT = 221;

export async function getSwingMapOverview(): Promise<SwingMapOverview> {
  const now = Date.now();
  const settled = await Promise.allSettled(
    CRYPTO_FLOW_INSTRUMENTS.map(async (inst) => {
      const [daily, h4] = await Promise.all([
        fetchBinanceKlines(inst.symbol, inst.market, fetch, "1d", DAILY_LIMIT),
        fetchBinanceKlines(inst.symbol, inst.market, fetch, "4h", H4_LIMIT),
      ]);
      const row = computeSwingMap(inst.symbol, daily, h4, now);
      if (!row) throw new CryptoFlowProviderError("invalid_response", "Not enough history");
      return row;
    }),
  );
  const rows: SwingMapOverviewRow[] = settled.map((r, idx) => {
    const symbol = CRYPTO_FLOW_INSTRUMENTS[idx].symbol;
    if (r.status === "fulfilled") return { symbol, status: "ok", data: r.value };
    const short = r.reason instanceof CryptoFlowProviderError && r.reason.message === "Not enough history";
    return { symbol, status: "unavailable", message: short ? "Not enough daily history yet" : "Temporarily unavailable" };
  });
  return { rows, asOf: now };
}
