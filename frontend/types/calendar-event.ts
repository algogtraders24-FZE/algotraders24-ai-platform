// types/calendar-event.ts
import type { EconomicEvent } from "./economic-event";

export interface CalendarDay {
  date: string; // YYYY-MM-DD
  events: EconomicEvent[];
}