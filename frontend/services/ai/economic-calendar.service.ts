// services/ai/economic-calendar.service.ts
import type { EconomicEvent } from "@/types/economic-event";
import type { CalendarDay } from "@/types/calendar-event";
import { calendar } from "@/data/calendar";
import { economicEvents } from "@/data/economic-events";

export function getCalendar(): CalendarDay[] {
  return calendar;
}

export function getHighImpactEvents(): EconomicEvent[] {
  return economicEvents.filter((e) => e.impact === "high");
}