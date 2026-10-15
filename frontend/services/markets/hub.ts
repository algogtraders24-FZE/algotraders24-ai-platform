// services/markets/hub.ts
// Public market hub pages (/markets/<slug>): one page per instrument built ONLY from numbers the platform already computes -
// the validated volatility range (widened around scheduled US releases), yesterday's high / low, the macro-driver reading, upcoming
// high-impact events, the live calibration hit rate of the ranges, the latest published analyses and the matching marketplace
// listings. Nothing here is a forecast of direction. Each section is optional: a source that is down simply leaves its section
// out, never an estimate. The data is memoised per slug for 10 minutes so crawlers cannot exhaust the market-data providers.

import { ASSET_PROFILES, type AssetId } from "@/services/macro/macro-alignment";
import { fmtDist, fmtPrice, keyLevelsLine, rangeText, rangesFor, type EventContext, type RangeEvent } from "@/services/smc/expected-range";
import type { SmcAnalysis } from "@/services/smc/smc-engine";
import type { CalibrationRow } from "@/services/calibration/forecast";

export interface MarketDef {
  slug: string;
  symbol: string;
  /** Short name used in titles. */
  name: string;
  /** Full display name. */
  longName: string;
  asset: AssetId;
  /** Marketplace asset tag (filter vocabulary) for the related listings. */
  assetTag: string;
  blogMatch: RegExp;
  /** One honest paragraph on what this market is and how the platform reads it. */
  about: string;
}

export const MARKETS: readonly MarketDef[] = [
  {
    slug: "gold", symbol: "XAUUSD", name: "Gold", longName: "Gold (XAU/USD)", asset: "gold", assetTag: "Gold", blogMatch: /\bgold\b|XAU/i,
    about: "Gold is quoted in US dollars, so the dollar and US interest rates matter more to it than to most assets. The platform reads five drivers - real yields, the dollar index, Treasury yields, a risk-off barometer and gold's own momentum - and reports how many point the same way. It also measures how far gold typically moves over the next 12 and 24 hours and checks that statement against what happened.",
  },
  {
    slug: "silver", symbol: "XAGUSD", name: "Silver", longName: "Silver (XAG/USD)", asset: "silver", assetTag: "Silver", blogMatch: /\bsilver\b|XAG/i,
    about: "Silver trades partly as a precious metal and partly as an industrial one, and it usually moves more per day than gold. The platform reads real yields, the dollar, stock-market risk appetite, Treasury yields and silver's own momentum, and measures its typical 12 and 24 hour move.",
  },
  {
    slug: "eur-usd", symbol: "EURUSD", name: "EUR/USD", longName: "Euro / US Dollar (EUR/USD)", asset: "eurusd", assetTag: "Forex", blogMatch: /EUR\/USD/i,
    about: "EUR/USD is the most traded currency pair. The platform reads the dollar index, European and US yield context, risk appetite and the pair's own momentum, and tracks scheduled US and euro-area releases that tend to move it.",
  },
  {
    slug: "gbp-usd", symbol: "GBPUSD", name: "GBP/USD", longName: "British Pound / US Dollar (GBP/USD)", asset: "gbpusd", assetTag: "Forex", blogMatch: /GBP\/USD/i,
    about: "GBP/USD reacts to both Bank of England and Federal Reserve news. The platform reads the dollar, yields, risk appetite and the pair's own momentum, and tracks scheduled US and UK releases.",
  },
  {
    slug: "usd-jpy", symbol: "USDJPY", name: "USD/JPY", longName: "US Dollar / Japanese Yen (USD/JPY)", asset: "usdjpy", assetTag: "Forex", blogMatch: /USD\/JPY/i,
    about: "USD/JPY is closely tied to US yields and to risk sentiment (the yen is a funding and safe-haven currency). The platform reads the dollar, yields, risk appetite and the pair's own momentum, and tracks scheduled US and Japanese releases.",
  },
  {
    slug: "bitcoin", symbol: "BTCUSD", name: "Bitcoin", longName: "Bitcoin (BTC/USD)", asset: "btcusd", assetTag: "Crypto", blogMatch: /bitcoin|BTC/i,
    about: "Bitcoin trades around the clock and is more volatile than gold or the major currencies. The platform reads the dollar, risk appetite, yields and bitcoin's own momentum, and measures its typical 12 and 24 hour move (crypto markets react less to US releases than gold, and the range widening reflects that).",
  },
  {
    slug: "ethereum", symbol: "ETHUSD", name: "Ethereum", longName: "Ethereum (ETH/USD)", asset: "ethusd", assetTag: "Crypto", blogMatch: /ethereum|ETH\//i,
    about: "Ethereum trades around the clock and usually moves more than Bitcoin. The platform reads the dollar, risk appetite, yields and ether's own momentum, and measures its typical 12 and 24 hour move. Crypto-class range factors are used for it; they were tested on Bitcoin.",
  },
];

export const marketBySlug = (slug: string): MarketDef | undefined => MARKETS.find((m) => m.slug === slug);

export interface HubEvent {
  title: string;
  currency: string;
  utc: string;
  inText: string;
  forecast: string | null;
  previous: string | null;
}

export interface HubView {
  def: MarketDef;
  generatedAt: string;
  price: { text: string; changePct: number | null } | null;
  /** Both horizons with the event widening applied, and the plain-language note when one was. */
  ranges: { r12: string; r24: string; widenedNote: string | null } | null;
  levels: string | null;
  structure: { bias1h: string; bias4h: string; volatility: string } | null;
  macro: { label: string; score: number | null; drivers: string; available: number; total: number } | null;
  events: HubEvent[];
  drivers: Array<{ label: string; rule: string; weight: number }>;
  calibration: { row12: CalibrationRow | null; row24: CalibrationRow | null };
  analyses: Array<{ slug: string; title: string; publishedAt: string }>;
  listings: Array<{ slug: string; title: string; price: string | null; platform: string }>;
}

export interface HubInputs {
  smc: SmcAnalysis | null;
  macro: { alignment: { label: string; score: number | null; availableDrivers: number; totalDrivers: number }; price: { text: string; changePct: number } | null } | null;
  events: readonly (RangeEvent & { forecast?: string | null; previous?: string | null })[] | null;
  calibration: readonly CalibrationRow[] | null;
  posts: ReadonlyArray<{ slug: string; title: string; publishedAt: string }> | null;
  listings: ReadonlyArray<{ slug: string; title: string; pricing: { amount?: number; currency?: string }; platformTag: string }> | null;
}

const untilText = (ms: number): string => {
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `in ${Math.max(mins, 0)} min`;
  const h = Math.floor(mins / 60);
  return h >= 48 ? `in ${Math.floor(h / 24)} days` : `in ${h}h ${mins % 60}m`;
};

export function driverRule(label: string, direction: 1 | -1): string {
  return direction === -1 ? `a rise in ${label.toLowerCase()} counts as a headwind` : `a rise in ${label.toLowerCase()} counts as support`;
}

/** Pure: turn the raw inputs into what the page shows. Every part is optional. */
export function buildHubView(def: MarketDef, inp: HubInputs, nowMs: number): HubView {
  const profile = ASSET_PROFILES[def.asset];
  const ctx: EventContext = { symbol: def.symbol, nowMs, events: inp.events };
  const a = inp.smc;

  let ranges: HubView["ranges"] = null;
  let levels: string | null = null;
  let structure: HubView["structure"] = null;
  if (a) {
    const r = rangesFor(a, ctx);
    if (r) {
      const widened = r.r12.factor > 1 || r.r24.factor > 1;
      ranges = {
        r12: rangeText(r.r12, a.price),
        r24: rangeText(r.r24, a.price),
        widenedNote: widened ? `Widened because ${r.events[0].label} falls inside the window (12h x${r.r12.factor}, 24h x${r.r24.factor}).` : null,
      };
    }
    levels = keyLevelsLine(a);
    structure = { bias1h: a.bias.toLowerCase(), bias4h: a.htf.bias.toLowerCase(), volatility: a.volatility === "--" ? "not available" : `${a.volatility.toLowerCase()}${a.volatilityRatio !== null ? ` (ATR ${a.volatilityRatio.toFixed(2)}x its recent average)` : ""}` };
  }

  const upcoming: HubEvent[] = (inp.events ?? [])
    .filter((e) => e.impact === "high" && !e.isHoliday && !e.allDay)
    .map((e) => ({ e, t: new Date(e.eventTime).getTime() }))
    .filter(({ t }) => Number.isFinite(t) && t >= nowMs)
    .sort((x, y) => x.t - y.t)
    .slice(0, 5)
    .map(({ e, t }) => ({ title: e.title, currency: e.currency, utc: new Date(t).toISOString().replace("T", " ").slice(0, 16) + " UTC", inText: untilText(t - nowMs), forecast: e.forecast ?? null, previous: e.previous ?? null }));

  const cal = inp.calibration ?? [];
  return {
    def,
    generatedAt: new Date(nowMs).toISOString(),
    price: a ? { text: fmtPrice(a.price), changePct: inp.macro?.price?.changePct ?? null } : inp.macro?.price ? { text: inp.macro.price.text, changePct: inp.macro.price.changePct } : null,
    ranges,
    levels,
    structure,
    macro: inp.macro
      ? {
          label: inp.macro.alignment.label,
          score: inp.macro.alignment.score,
          drivers: `${inp.macro.alignment.availableDrivers} of ${inp.macro.alignment.totalDrivers} drivers have data`,
          available: inp.macro.alignment.availableDrivers,
          total: inp.macro.alignment.totalDrivers,
        }
      : null,
    events: upcoming,
    drivers: profile.drivers.map((d) => ({ label: d.label, rule: driverRule(d.label, d.direction), weight: d.weight })),
    calibration: { row12: cal.find((r) => r.horizon === 12) ?? null, row24: cal.find((r) => r.horizon === 24) ?? null },
    analyses: (inp.posts ?? []).filter((p) => def.blogMatch.test(p.title)).sort((x, y) => y.publishedAt.localeCompare(x.publishedAt)).slice(0, 5),
    listings: (inp.listings ?? []).slice(0, 3).map((l) => ({ slug: l.slug, title: l.title, platform: l.platformTag, price: typeof l.pricing.amount === "number" ? `${l.pricing.currency && l.pricing.currency !== "USD" ? `${l.pricing.currency} ` : "$"}${l.pricing.amount}` : null })),
  };
}

export { fmtDist };
