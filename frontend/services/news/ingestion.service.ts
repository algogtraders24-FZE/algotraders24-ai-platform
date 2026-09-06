// services/news/ingestion.service.ts
// AN1.2 - orchestrates one real ingestion attempt per provider: reserve
// quota -> fetch -> normalize -> persist -> log. Called by both the
// scheduled cron route and Market Intelligence's on-demand cache-miss
// fallback (the "shared ingestion, not two independent fetchers"
// requirement), so there is exactly one code path that ever calls a real
// provider.
import "server-only";
import { tryReserveProviderCall, logProviderCall } from "./quota.service";
import { fetchAlphaVantageNews, ALPHA_VANTAGE_PROVIDER } from "./providers/alpha-vantage.provider";
import { fetchCryptoPanicNews, CRYPTOPANIC_PROVIDER } from "./providers/cryptopanic.provider";
import { normalizeAlphaVantageArticle, normalizeCryptoPanicArticle } from "./normalize.service";
import { persistArticles } from "./store.service";
import { alphaVantageDailyLimit, cryptoPanicDailyLimit, loadCryptoPanicEnv } from "./config";

// AN1.5 - one topic-based call already returns general market news covering
// everything; never query per-symbol (would multiply real quota usage for
// no benefit - ticker_sentiment is present on every article regardless).
const ALPHA_VANTAGE_TOPICS = ["financial_markets", "economy_macro"];
// AN1.4's locked crypto scope: BTC/ETH/SOL/XRP (AT24's enabled crypto set).
const CRYPTOPANIC_CURRENCY_CODES = ["BTC", "ETH", "SOL", "XRP"];

export type IngestionPurpose = "scheduled-ingestion" | "on-demand-fallback";

export interface IngestionResult {
  provider: string;
  attempted: boolean;
  reserved: boolean;
  success: boolean;
  articleCount: number;
  created: number;
  updated: number;
  errorMessage?: string;
}

function skippedResult(provider: string, reason: string): IngestionResult {
  return { provider, attempted: false, reserved: false, success: false, articleCount: 0, created: 0, updated: 0, errorMessage: reason };
}

export async function ingestAlphaVantage(purpose: IngestionPurpose): Promise<IngestionResult> {
  const reserved = await tryReserveProviderCall(ALPHA_VANTAGE_PROVIDER, alphaVantageDailyLimit());
  if (!reserved) return skippedResult(ALPHA_VANTAGE_PROVIDER, "daily quota exhausted");

  try {
    const raw = await fetchAlphaVantageNews(ALPHA_VANTAGE_TOPICS);
    const normalized = raw.map(normalizeAlphaVantageArticle);
    const { created, updated } = await persistArticles(normalized);
    await logProviderCall(ALPHA_VANTAGE_PROVIDER, purpose, true);
    return { provider: ALPHA_VANTAGE_PROVIDER, attempted: true, reserved: true, success: true, articleCount: normalized.length, created, updated };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    await logProviderCall(ALPHA_VANTAGE_PROVIDER, purpose, false, message);
    return { provider: ALPHA_VANTAGE_PROVIDER, attempted: true, reserved: true, success: false, articleCount: 0, created: 0, updated: 0, errorMessage: message };
  }
}

export async function ingestCryptoPanic(purpose: IngestionPurpose): Promise<IngestionResult> {
  // Optional secondary provider - its absence must never block Alpha
  // Vantage's real, primary ingestion, and an unconfigured provider should
  // never occupy a quota slot for a call that was never going to happen.
  if (!loadCryptoPanicEnv()) return skippedResult(CRYPTOPANIC_PROVIDER, "not configured (missing CRYPTOPANIC_AUTH_TOKEN)");

  const reserved = await tryReserveProviderCall(CRYPTOPANIC_PROVIDER, cryptoPanicDailyLimit());
  if (!reserved) return skippedResult(CRYPTOPANIC_PROVIDER, "daily quota exhausted");

  try {
    const raw = await fetchCryptoPanicNews(CRYPTOPANIC_CURRENCY_CODES);
    const normalized = raw.map(normalizeCryptoPanicArticle);
    const { created, updated } = await persistArticles(normalized);
    await logProviderCall(CRYPTOPANIC_PROVIDER, purpose, true);
    return { provider: CRYPTOPANIC_PROVIDER, attempted: true, reserved: true, success: true, articleCount: normalized.length, created, updated };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    await logProviderCall(CRYPTOPANIC_PROVIDER, purpose, false, message);
    return { provider: CRYPTOPANIC_PROVIDER, attempted: true, reserved: true, success: false, articleCount: 0, created: 0, updated: 0, errorMessage: message };
  }
}

/** The cron entry point - runs both providers, one after another (never in parallel, so a burst never risks tripping either provider's per-second throttle). */
export async function runScheduledIngestion(): Promise<IngestionResult[]> {
  const alphaVantage = await ingestAlphaVantage("scheduled-ingestion");
  const cryptoPanic = await ingestCryptoPanic("scheduled-ingestion");
  return [alphaVantage, cryptoPanic];
}
