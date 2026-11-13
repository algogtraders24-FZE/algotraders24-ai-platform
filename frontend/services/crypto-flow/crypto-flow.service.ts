// services/crypto-flow/crypto-flow.service.ts
// Reads the Binance klines through the provider and shapes them with the pure maths in compute.ts.
import "server-only";
import type { CryptoFlowResponse, CryptoFlowSymbol } from "@/types/crypto-flow";
import { CryptoFlowProviderError, fetchBinanceKlines } from "./binance.provider";
import { computeCryptoFlow } from "./compute";

export async function getCryptoFlow(symbol: CryptoFlowSymbol): Promise<CryptoFlowResponse> {
  const rows = await fetchBinanceKlines(symbol);
  const result = computeCryptoFlow(symbol, rows, Date.now());
  if (!result) throw new CryptoFlowProviderError("invalid_response", "Not enough closed minutes returned");
  return result;
}
