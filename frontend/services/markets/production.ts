// services/markets/production.ts
// Production wiring for the public market hub pages: loads each source independently (a failing one leaves its section out),
// and memoises the finished view per slug for 10 minutes in-process, so crawlers and visitors cannot exhaust the market-data
// providers (Twelve Data allows 8 requests a minute). Concurrent requests share one load.
import "server-only";
import { getSmcAnalysis } from "@/services/smc/smc-service";
import { getMacroAlignmentSnapshot } from "@/services/macro/macro-service";
import { ASSET_PROFILES } from "@/services/macro/macro-alignment";
import { getEconomicCalendar } from "@/services/calendar/calendar.service";
import { readScoreboard } from "@/services/calibration/production";
import { blogReaderService } from "@/services/publishing/blog-reader.service";
import { MarketplaceCatalogue } from "@/services/marketplace/MarketplaceCatalogue";
import { buildHubView, type HubInputs, type HubView, type MarketDef } from "./hub";

const TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; view: Promise<HubView> }>();

async function settle<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch {
    return null;
  }
}

async function load(def: MarketDef): Promise<HubView> {
  const profile = ASSET_PROFILES[def.asset];
  // USD is always requested (the range widening is tied to US releases) plus the market's own currencies.
  const currencies = [...new Set(["USD", ...profile.calendarCurrencies])];
  const [smc, macro, calendar, board, posts, listings] = await Promise.all([
    settle(getSmcAnalysis(def.symbol)),
    settle(getMacroAlignmentSnapshot(def.asset)),
    settle(getEconomicCalendar({ week: "this", currencies, impacts: ["high"] })),
    settle(readScoreboard()),
    settle(blogReaderService.listPosts()),
    settle(MarketplaceCatalogue.search({ asset: def.assetTag, page: 1, pageSize: 3, sort: "newest" })),
  ]);
  const inputs: HubInputs = {
    smc,
    macro: macro ? { alignment: macro.alignment, price: macro.price } : null,
    events: calendar ? calendar.events : null,
    calibration: board && board.available ? board.bySymbol.filter((r) => r.symbol === def.symbol) : null,
    posts: posts ? posts.map((p) => ({ slug: p.slug, title: p.title, publishedAt: p.publishedAt })) : null,
    listings: listings ? listings.items : null,
  };
  return buildHubView(def, inputs, Date.now());
}

export function getMarketHub(def: MarketDef): Promise<HubView> {
  const hit = cache.get(def.slug);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.view;
  const view = load(def);
  cache.set(def.slug, { at: Date.now(), view });
  // a failed load must not be cached for ten minutes
  view.catch(() => cache.delete(def.slug));
  return view;
}
