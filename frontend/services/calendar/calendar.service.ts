// services/calendar/calendar.service.ts
// AN2 - the read path the API route calls. Fetch-through, no persistence:
// the FairEconomy feed is small (~80 rows/week) and authoritative, and the
// route's own cache (calendarCacheTtlSeconds) collapses bursts to one
// upstream call - so a stored NewsArticle-style table would add a migration
// and a cron for no real gain here. If a future provider brings released
// `actual` values (which update intraday), revisit: those want either a
// shorter TTL or a store.
import "server-only";
import { fetchFairEconomyWeek, type CalendarFetch } from "./faireconomy.provider";
import { normalizeFairEconomyFeed } from "./normalize.service";
import { calendarStaleThresholdMs, CALENDAR_SOURCE_LABEL } from "./config";
import type { CalendarWeek, EconomicCalendarResponse, EconomicEvent } from "@/types/economic-calendar";

export interface CalendarQuery {
  week: CalendarWeek;
  /** Upper-cased currency codes to keep (e.g. ["USD","EUR"]). Empty/undefined = all. */
  currencies?: string[];
  /** Impacts to keep. Empty/undefined = all. */
  impacts?: EconomicEvent["impact"][];
}

function applyFilters(events: EconomicEvent[], query: CalendarQuery): EconomicEvent[] {
  const currencySet = query.currencies && query.currencies.length > 0 ? new Set(query.currencies.map((c) => c.toUpperCase())) : null;
  const impactSet = query.impacts && query.impacts.length > 0 ? new Set(query.impacts) : null;
  return events.filter((e) => {
    if (currencySet && !currencySet.has(e.currency)) return false;
    if (impactSet && !impactSet.has(e.impact)) return false;
    return true;
  });
}

/**
 * Returns the (filtered) calendar plus a freshness stamp. Throws whatever
 * the provider throws (CalendarProviderError) - the route converts that to
 * a 502 with a safe message.
 */
export async function getEconomicCalendar(query: CalendarQuery, fetchImpl?: CalendarFetch): Promise<EconomicCalendarResponse> {
  const rows = await fetchFairEconomyWeek(query.week, fetchImpl);
  const normalized = normalizeFairEconomyFeed(rows);
  const events = applyFilters(normalized, query);

  // Fetch-through: "fetchedAt" is now. The route cache may have served the
  // upstream body from an earlier fetch, but Next revalidates within
  // calendarCacheTtlSeconds, so the true age is bounded by that and
  // treating it as fresh here is honest within the stale threshold.
  const fetchedAt = new Date().toISOString();

  return {
    events,
    week: query.week,
    freshness: {
      fetchedAt,
      source: CALENDAR_SOURCE_LABEL,
      isStale: Date.now() - new Date(fetchedAt).getTime() > calendarStaleThresholdMs(),
    },
  };
}
