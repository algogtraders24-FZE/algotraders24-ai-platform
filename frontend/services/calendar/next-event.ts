// services/calendar/next-event.ts
// The next upcoming high-impact event (pure). Used by the dashboard's
// "Next risk event" card.

import type { EconomicEvent } from "@/types/economic-calendar";

export interface NextEvent {
  title: string;
  currency: string;
  /** UTC ISO. */
  eventTime: string;
  forecast: string | null;
  previous: string | null;
}

/** Earliest high-impact, non-holiday, timed event at or after `now`, or null. */
export function pickNextHighImpactEvent(events: readonly Pick<EconomicEvent, "title" | "currency" | "impact" | "isHoliday" | "allDay" | "eventTime" | "forecast" | "previous">[], now: Date): NextEvent | null {
  let best: { e: (typeof events)[number]; t: number } | null = null;
  for (const e of events) {
    if (e.impact !== "high" || e.isHoliday || e.allDay) continue;
    const t = new Date(e.eventTime).getTime();
    if (!Number.isFinite(t) || t < now.getTime()) continue;
    if (!best || t < best.t) best = { e, t };
  }
  return best ? { title: best.e.title, currency: best.e.currency, eventTime: best.e.eventTime, forecast: best.e.forecast ?? null, previous: best.e.previous ?? null } : null;
}
