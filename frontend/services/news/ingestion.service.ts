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
import { fetchMarketauxNews, MARKETAUX_PROVIDER, MARKETAUX_SYMBOLS } from "./providers/marketaux.provider";
import { normalizeAlphaVantageArticle, normalizeCryptoPanicArticle, normalizeMarketauxArticle } from "./normalize.service";
import { persistArticles } from "./store.service";
import { alphaVantageDailyLimit, cryptoPanicDailyLimit, loadCryptoPanicEnv, loadMarketauxEnv, marketauxDailyLimit } from "./config";

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

/** How far back each Marketaux request looks. Wider than the cadence so a missed run still catches up; re-ingested articles dedupe. */
const MARKETAUX_LOOKBACK_MS = 48 * 60 * 60 * 1000;

/**
 * Marketaux: one request per AT24 symbol it covers (Gold/Silver are not Marketaux entities). Each request reserves one call from the daily budget, so the
 * free plan's 100/day can never be exceeded. A symbol that fails or runs out of budget does not stop the others; the run counts as a success when at least
 * one symbol returned.
 */
export async function ingestMarketaux(purpose: IngestionPurpose): Promise<IngestionResult> {
  if (!loadMarketauxEnv()) return skippedResult(MARKETAUX_PROVIDER, "not configured (missing MARKETAUX_API_TOKEN)");

  const since = new Date(Date.now() - MARKETAUX_LOOKBACK_MS);
  let attempted = false;
  let reservedAny = false;
  let articleCount = 0;
  let created = 0;
  let updated = 0;
  let okCalls = 0;
  const errors: string[] = [];

  for (const symbol of MARKETAUX_SYMBOLS) {
    const reserved = await tryReserveProviderCall(MARKETAUX_PROVIDER, marketauxDailyLimit());
    if (!reserved) {
      errors.push("daily quota exhausted");
      break;
    }
    reservedAny = true;
    attempted = true;
    try {
      const raw = await fetchMarketauxNews(symbol, since);
      const normalized = raw.map(normalizeMarketauxArticle);
      const result = await persistArticles(normalized);
      articleCount += normalized.length;
      created += result.created;
      updated += result.updated;
      okCalls += 1;
    } catch (error) {
      errors.push(`${symbol}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  const success = okCalls > 0;
  if (attempted) await logProviderCall(MARKETAUX_PROVIDER, purpose, success, success ? undefined : errors.join("; ").slice(0, 500));
  return { provider: MARKETAUX_PROVIDER, attempted, reserved: reservedAny, success, articleCount, created, updated, errorMessage: errors.length > 0 ? errors.join("; ").slice(0, 300) : undefined };
}

/** The cron entry point - runs both providers, one after another (never in parallel, so a burst never risks tripping either provider's per-second throttle). */
export async function runScheduledIngestion(): Promise<IngestionResult[]> {
  // Marketaux first: it is the provider that works on the free tier today (Alpha Vantage's news endpoint became premium-only on 2026-10-06).
  const marketaux = await ingestMarketaux("scheduled-ingestion");
  const alphaVantage = await ingestAlphaVantage("scheduled-ingestion");
  const cryptoPanic = await ingestCryptoPanic("scheduled-ingestion");
  return [marketaux, alphaVantage, cryptoPanic];
}
