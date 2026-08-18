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

// Sprint D2.2 - Twelve Data becomes the primary market-data provider. Same
// optional-at-the-platform-level contract as Alpha Vantage above: returns
// null (never throws) when the key is absent, so the central MarketDataService
// can fall back to a secondary provider rather than hard-failing. Read from
// the server environment only - this key must NEVER be exposed through a
// NEXT_PUBLIC_* variable.
export interface TwelveDataEnv {
  apiKey: string;
}

export function loadTwelveDataEnv(): TwelveDataEnv | null {
  const apiKey = process.env.TWELVEDATA_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) return null;
  return { apiKey };
}

// Sprint D2.6.3 - Angel One SmartAPI credentials. Reads the EXACT
// existing variable names already present in this project's .env.local
// (API_KEY, CLIENT_CODE, PIN, TOTP_SECRET) - never renamed, never
// invented, per this sprint's explicit instruction not to touch
// credential naming. These names are intentionally generic in the
// current env file (not ANGEL_-prefixed) - a real collision risk worth
// flagging for a future cleanup (see the D2.6.3 architecture doc's
// "known limitations"), but out of scope to silently "fix" here. The
// project's own ANGEL_SMARTAPI variable is currently empty/unused and
// is deliberately not read by this loader. No value here is ever
// logged - see angel-one.provider.ts's header for the same rule applied
// to every derived credential (TOTP code, JWT, refresh token).
export interface AngelOneEnv {
  apiKey: string;
  clientCode: string;
  pin: string;
  totpSecret: string;
}

export function loadAngelOneEnv(): AngelOneEnv | null {
  const apiKey = process.env.API_KEY;
  const clientCode = process.env.CLIENT_CODE;
  const pin = process.env.PIN;
  const totpSecret = process.env.TOTP_SECRET;
  if (!apiKey?.trim() || !clientCode?.trim() || !pin?.trim() || !totpSecret?.trim()) return null;
  return { apiKey, clientCode, pin, totpSecret };
}

// Sprint D2.6.3 - Binance. Documented separately from the loader
// functions above for a reason worth stating explicitly: Binance's
// public market-data REST endpoints (ticker/24hr, klines) need NO
// credentials at all, so BinanceProvider never calls a loader here -
// see binance.provider.ts's header for the full explanation, including
// why the project's malformed BINANCE_API_KEY/SEC_KEY env line is moot
// for this capability.

// MT5 (Exness) live data bridge - see mt5-bridge/README.md for the full
// deployment story. Same optional-at-the-platform-level contract as every
// other loader: returns null (never throws) when either half is absent,
// so MarketDataService falls back to its other providers rather than
// hard-failing. bridgeUrl must be the bridge's own HTTPS origin (e.g.
// https://mt5.yourdomain.com) - never a plain-http URL in production,
// since the secret travels in the Authorization header over this
// connection.
export interface Mt5BridgeEnv {
  bridgeUrl: string;
  secret: string;
}

export function loadMt5BridgeEnv(): Mt5BridgeEnv | null {
  const bridgeUrl = process.env.MT5_BRIDGE_URL;
  const secret = process.env.MT5_BRIDGE_SECRET;
  if (!bridgeUrl?.trim() || !secret?.trim()) return null;
  // Strip a trailing slash so callers can always do `${bridgeUrl}/quote`
  // without producing a double slash - a pure normalization, never a
  // guess about the real host.
  return { bridgeUrl: bridgeUrl.trim().replace(/\/+$/, ""), secret: secret.trim() };
}
