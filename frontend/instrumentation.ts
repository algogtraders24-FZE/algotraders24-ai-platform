// instrumentation.ts
// Sprint D2.3.S3 - Objective 7: Deployment Validation. Next.js calls
// `register()` exactly once when a new server instance starts, before it
// serves any request (stable since Next 15, no experimental flag needed).
// This is the one place startup-time config problems get surfaced loudly
// instead of only being discovered the first time a request happens to fail
// with "unconfigured" - see docs/market-data-layer.md's troubleshooting
// section for why that's confusing on a freshly-deployed server.
//
// Only ever logs presence/absence of a key, never the value - same
// discipline every provider file in lib/market-data/ already follows.
export async function register() {
  // The Edge runtime also calls register() - only run this on the Node
  // runtime so the check (and its log lines) happens exactly once per real
  // server instance, not twice.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { logger } = await import("@/services/backend/Logger");
  const { loadTwelveDataEnv, loadAlphaVantageEnv } = await import("@/lib/market-data/env");
  const startup = logger.child("startup");

  const twelveDataConfigured = loadTwelveDataEnv() !== null;
  const alphaVantageConfigured = loadAlphaVantageEnv() !== null;

  if (!twelveDataConfigured && !alphaVantageConfigured) {
    startup.error(
      "No market-data provider configured - TWELVEDATA_API_KEY and ALPHA_VANTAGE_API_KEY are both missing. Market data features will report Data Unavailable until at least one is set.",
    );
    return;
  }
  if (!twelveDataConfigured) {
    startup.warn(
      "TWELVEDATA_API_KEY is not set - the primary market-data provider is disabled. Alpha Vantage will serve alone (EUR/USD, Gold, Silver spot only - no crypto).",
    );
  }
  if (!alphaVantageConfigured) {
    startup.warn(
      "ALPHA_VANTAGE_API_KEY is not set - the fallback market-data provider is disabled. No redundancy if Twelve Data becomes unavailable.",
    );
  }
  if (twelveDataConfigured && alphaVantageConfigured) {
    startup.info("Market-data providers configured: twelve-data (primary), alpha-vantage (secondary).");
  }
}
