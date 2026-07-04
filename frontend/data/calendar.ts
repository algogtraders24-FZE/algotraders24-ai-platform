// data/calendar.ts
import type { CalendarDay } from "@/types/calendar-event";
import { economicEvents } from "./economic-events";

export const calendar: CalendarDay[] = [
  { date: "2025-01-15", events: economicEvents },
];