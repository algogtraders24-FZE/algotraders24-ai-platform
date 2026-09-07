// types/economic-calendar.ts
// AN2 - AT24's own shared contract for the Economic Calendar feature. The
// AI News page (app/dashboard/news/page.tsx) deliberately REMOVED the old
// mock "High Impact Economic Events" section in AN1.7 with an explicit note
// that "economic-calendar data needs its own future provider/contract/audit"
// - this file is that contract.
//
// Provider-independent by design: the FairEconomy/ForexFactory weekly feed
// is the only source AN2 ships with, but nothing below is shaped around its
// JSON. `provider` is kept on every event so a second source (one that also
// carries the released `actual` value, which the free FairEconomy feed does
// NOT) can be added later without a schema change.

/**
 * AT24's normalized impact scale. FairEconomy emits "High" | "Medium" |
 * "Low" | "Holiday"; "Holiday" is folded to `low` here and flagged
 * separately via `isSpeech`/`allDay` on the event where relevant, because
 * downstream impact filtering only ever means "how much does this move
 * price" - a bank holiday is genuinely low-impact for that purpose.
 */
export const ECONOMIC_IMPACTS = ["high", "medium", "low"] as const;
export type EconomicImpact = (typeof ECONOMIC_IMPACTS)[number];

/**
 * The currency filter row shown in the UI. Not an allow-list on ingestion -
 * every currency the feed returns is kept and served; this is only the set
 * of one-click filter chips (the majors every FX/metals trader watches).
 * FairEconomy uses "All" as the country for global/non-currency rows
 * (bank holidays spanning regions) - those are kept and surface under the
 * "All currencies" view only.
 */
export const CALENDAR_FILTER_CURRENCIES = ["USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD", "CNY"] as const;
export type CalendarFilterCurrency = (typeof CALENDAR_FILTER_CURRENCIES)[number];

/** Only "this" ships in AN2 - FairEconomy's `nextweek`/`lastweek` feed files currently 404. The type is kept wider so adding them later is not a breaking change. */
export const CALENDAR_WEEKS = ["this"] as const;
export type CalendarWeek = (typeof CALENDAR_WEEKS)[number];

export interface EconomicEvent {
  /** Deterministic: sha256(`${eventTime}|${currency}|${title}`) truncated. Stable across refetches so the client can key rows and diff. */
  id: string;
  title: string;
  /** ISO-4217 currency code, or "ALL" for global rows (bank holidays). Upper-cased. */
  currency: string;
  impact: EconomicImpact;
  /** True when FairEconomy classified the row as a bank holiday rather than a data release. */
  isHoliday: boolean;
  /** UTC ISO-8601. FairEconomy dates carry a US-Eastern offset; normalization converts to UTC. */
  eventTime: string;
  /**
   * FairEconomy publishes some rows with no clock time ("All Day",
   * "Tentative"). We cannot recover which from the feed (it only gives a
   * datetime), so this stays false for AN2 - documented rather than guessed.
   */
  allDay: boolean;
  /** Consensus forecast, verbatim from the feed (e.g. "2.65%", "162K", ""). Empty string -> null. */
  forecast: string | null;
  /** Prior release value, verbatim from the feed. Empty string -> null. */
  previous: string | null;
  /**
   * The released value. ALWAYS null in AN2: the free FairEconomy feed does
   * not carry it. Present on the type so a future provider that does can
   * populate it without a contract change - and so the UI can render the
   * column as an honest "-" today instead of hiding it.
   */
  actual: string | null;
  /** Source label shown to the user. */
  provider: string;
}

export interface CalendarFreshness {
  /** When AT24 last successfully fetched the upstream feed (UTC ISO). */
  fetchedAt: string;
  /** Human source attribution. */
  source: string;
  /**
   * True when the last successful fetch is older than the staleness
   * threshold (the route serves a cached copy for up to s-maxage, so a
   * brief upstream outage still returns data - just flagged).
   */
  isStale: boolean;
}

export interface EconomicCalendarResponse {
  events: EconomicEvent[];
  week: CalendarWeek;
  freshness: CalendarFreshness;
}

export function isEconomicImpact(value: string): value is EconomicImpact {
  return (ECONOMIC_IMPACTS as readonly string[]).includes(value);
}

export function isCalendarWeek(value: string): value is CalendarWeek {
  return (CALENDAR_WEEKS as readonly string[]).includes(value);
}
