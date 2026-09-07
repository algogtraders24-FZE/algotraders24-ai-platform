// services/calendar/normalize.service.ts
// AN2 - turns untrusted FairEconomy feed rows into AT24's typed
// EconomicEvent contract. Every field is validated; a row that fails any
// hard check (no title, unparseable date, unknown impact) is dropped
// rather than served half-formed. Mirrors services/news/normalize.service.
import "server-only";
import { createHash } from "node:crypto";
import type { RawFairEconomyEvent } from "./faireconomy.provider";
import { CALENDAR_SOURCE_LABEL } from "./config";
import type { EconomicEvent, EconomicImpact } from "@/types/economic-calendar";

// FairEconomy -> AT24 impact. "Holiday" is a real value in the feed and is
// folded to `low` (with isHoliday preserved on the event) - for price-impact
// filtering a bank holiday genuinely is low-impact.
const IMPACT_MAP: Record<string, EconomicImpact> = {
  high: "high",
  medium: "medium",
  low: "low",
  holiday: "low",
};

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function stableId(eventTimeIso: string, currency: string, title: string): string {
  return createHash("sha256").update(`${eventTimeIso}|${currency}|${title}`).digest("hex").slice(0, 16);
}

/**
 * Normalize one raw row. Returns null when the row cannot be trusted:
 *  - missing/blank title
 *  - missing/blank country
 *  - date absent or not parseable to a real instant
 *  - impact not one of the known FairEconomy values
 */
export function normalizeFairEconomyEvent(raw: RawFairEconomyEvent): EconomicEvent | null {
  const title = cleanString(raw.title);
  if (!title) return null;

  const country = cleanString(raw.country);
  if (!country) return null;
  // "All" is FairEconomy's marker for a global / non-currency row (regional
  // bank holidays). Normalize to a sentinel rather than a real ISO code.
  const currency = country.toUpperCase() === "ALL" ? "ALL" : country.toUpperCase();

  const rawDate = cleanString(raw.date);
  if (!rawDate) return null;
  const parsed = new Date(rawDate);
  if (Number.isNaN(parsed.getTime())) return null;
  const eventTime = parsed.toISOString();

  const rawImpact = cleanString(raw.impact);
  if (!rawImpact) return null;
  const impact = IMPACT_MAP[rawImpact.toLowerCase()];
  if (!impact) return null;
  const isHoliday = rawImpact.toLowerCase() === "holiday";

  return {
    id: stableId(eventTime, currency, title),
    title,
    currency,
    impact,
    isHoliday,
    eventTime,
    allDay: false,
    forecast: cleanString(raw.forecast),
    previous: cleanString(raw.previous),
    // Free feed never carries this; a future provider can. Never inferred.
    actual: cleanString(raw.actual),
    provider: CALENDAR_SOURCE_LABEL,
  };
}

/**
 * Normalize a whole feed: drop untrustworthy rows, de-duplicate by stable
 * id (the feed occasionally repeats a row), and sort chronologically.
 */
export function normalizeFairEconomyFeed(rows: readonly RawFairEconomyEvent[]): EconomicEvent[] {
  const byId = new Map<string, EconomicEvent>();
  for (const row of rows) {
    const event = normalizeFairEconomyEvent(row);
    if (event && !byId.has(event.id)) byId.set(event.id, event);
  }
  return [...byId.values()].sort((a, b) => a.eventTime.localeCompare(b.eventTime));
}
