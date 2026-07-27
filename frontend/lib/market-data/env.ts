// lib/market-data/env.ts
// Sprint 15D.3A - Environment loading for market-data providers, mirroring
// lib/ai/env.ts's pattern with one deliberate difference: a market-data
// provider is optional at the platform level (MarketContextService already
// has a clean "unconfigured" path - see types/market-data-provider.ts and
// MarketDataProviderUnavailableError), so this returns null when the key
// is absent rather than throwing, unlike lib/ai/env.ts's fail-fast
// behavior for the mandatory chat provider.
export interface AlphaVantageEnv {
  apiKey: string;
}

export function loadAlphaVantageEnv(): AlphaVantageEnv | null {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) return null;
  return { apiKey };
}
