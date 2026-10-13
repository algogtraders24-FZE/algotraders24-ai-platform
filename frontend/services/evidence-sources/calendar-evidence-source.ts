// services/evidence-sources/calendar-evidence-source.ts
// "macro" evidence from the economic calendar (FairEconomy feed): the next
// high-impact events for the symbol's currencies, with forecast/previous. Every
// item is a fact the calendar reported; nothing is interpreted. If the feed
// answered and nothing is scheduled in the window, that is stated - but only when
// the whole window lies inside the fetched week (otherwise we cannot know).
//
// All items share ONE source name, so the ranking stage's conflict check (same
// type, different source) can never compare two calendar rows with each other.

import type { EvidenceItem } from "@/types/evidence";
import type { EvidenceExtraSource, EvidenceProviderRequest } from "@/types/evidence-fusion";
import { countdown } from "@/services/automation/brief-extras";
import { currenciesForSymbol } from "./symbol-currencies";

export const CALENDAR_EVIDENCE_SOURCE = "FairEconomy economic calendar";
const WINDOW_HOURS = 48;
const MAX_EVENTS = 3;

export interface CalendarRow {
  title: string;
  currency: string;
  impact: string;
  isHoliday?: boolean;
  allDay?: boolean;
  eventTime: string;
  forecast?: string | null;
  previous?: string | null;
}

export interface CalendarEvidenceDeps {
  getEvents?: (currencies: string[]) => Promise<CalendarRow[]>;
  now?: () => Date;
}

/** Monday 00:00 UTC after `d`: the calendar feed is the current week, so nothing beyond this is covered. */
export function endOfFetchedWeek(d: Date): Date {
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = out.getUTCDay(); // 0 = Sunday
  out.setUTCDate(out.getUTCDate() + (dow === 0 ? 1 : 8 - dow));
  return out;
}

const istText = (d: Date) =>
  d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

async function defaultGetEvents(currencies: string[]): Promise<CalendarRow[]> {
  // Lazy: the calendar service is server-only; resolving it at call time keeps this module (and anything that
  // imports it) loadable from plain scripts and tests.
  const { getEconomicCalendar } = await import("@/services/calendar/calendar.service");
  const res = await getEconomicCalendar({ week: "this", currencies, impacts: ["high"] });
  return res.events;
}

export class EconomicCalendarEvidenceSource implements EvidenceExtraSource {
  readonly name = "economic-calendar-evidence";
  readonly sourceType = "economic-calendar" as const;
  private readonly getEvents: (currencies: string[]) => Promise<CalendarRow[]>;
  private readonly now: () => Date;

  constructor(deps: CalendarEvidenceDeps = {}) {
    this.getEvents = deps.getEvents ?? defaultGetEvents;
    this.now = deps.now ?? (() => new Date());
  }

  isConfigured(): boolean {
    return true;
  }

  async collect(request: EvidenceProviderRequest): Promise<EvidenceItem[]> {
    const currencies = currenciesForSymbol(request.symbol);
    const rows = await this.getEvents(currencies); // throws on a feed failure -> the pipeline skips this source
    const now = this.now();
    const nowIso = now.toISOString();
    const windowEnd = new Date(now.getTime() + WINDOW_HOURS * 3600 * 1000);

    const upcoming = rows
      .filter((e) => e.impact === "high" && !e.isHoliday && !e.allDay)
      .map((e) => ({ e, t: new Date(e.eventTime) }))
      .filter(({ t }) => Number.isFinite(t.getTime()) && t.getTime() >= now.getTime() && t.getTime() <= windowEnd.getTime())
      .sort((a, b) => a.t.getTime() - b.t.getTime())
      .slice(0, MAX_EVENTS);

    if (upcoming.length === 0) {
      // part of the window is next week's feed: we cannot claim "none"
      if (windowEnd.getTime() > endOfFetchedWeek(now).getTime()) return [];
      return [
        {
          type: "macro",
          symbol: request.symbol,
          claim: `No high-impact ${currencies.join("/")} economic events are scheduled in the next ${WINDOW_HOURS} hours`,
          source: CALENDAR_EVIDENCE_SOURCE,
          asOf: nowIso,
          retrievedAt: nowIso,
        },
      ];
    }

    return upcoming.map(({ e, t }) => {
      const detail = [e.forecast ? `forecast ${e.forecast}` : null, e.previous ? `previous ${e.previous}` : null].filter(Boolean).join(", ");
      return {
        type: "macro" as const,
        symbol: request.symbol,
        claim: `High-impact ${e.currency} event ahead: ${e.title} on ${istText(t)} IST (${countdown(t.getTime() - now.getTime())})${detail ? `, ${detail}` : ""}`,
        source: CALENDAR_EVIDENCE_SOURCE,
        asOf: nowIso,
        retrievedAt: nowIso,
      };
    });
  }
}
