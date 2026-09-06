// services/news/config.ts
// AN1.2/AN1.6 - env-driven configuration, so a future paid-tier upgrade or
// threshold change never needs a code change. Every value has a safe,
// documented default matching what was actually locked during design.
function readPositiveInt(envVar: string, fallback: number): number {
  const raw = Number(process.env[envVar]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

/** Alpha Vantage free tier is 25 requests/day - configurable so a paid-tier upgrade needs no code change. */
export function alphaVantageDailyLimit(): number {
  return readPositiveInt("NEWS_ALPHA_VANTAGE_DAILY_LIMIT", 25);
}

/** CryptoPanic's own limit is far more generous (5-10 req/sec), but AN1.2 deliberately keeps ingestion conservative regardless - a few calls/day, not hourly polling merely because the provider allows it. */
export function cryptoPanicDailyLimit(): number {
  return readPositiveInt("NEWS_CRYPTOPANIC_DAILY_LIMIT", 12);
}

/** Locked at AN1.6: with a few-times-per-day ingestion schedule, 12h tolerates one missed cycle without yesterday's news looking current. */
export function staleThresholdMs(): number {
  return readPositiveInt("NEWS_STALE_THRESHOLD_HOURS", 12) * 60 * 60 * 1000;
}

export interface CryptoPanicEnv {
  authToken: string;
}

export function loadCryptoPanicEnv(): CryptoPanicEnv | null {
  const authToken = process.env.CRYPTOPANIC_AUTH_TOKEN;
  if (!authToken || authToken.trim().length === 0) return null;
  return { authToken };
}
