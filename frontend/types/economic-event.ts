// types/economic-event.ts
import type { ImpactLevel } from "./news-impact";

export type EventImportance = "low" | "medium" | "high";

export interface EconomicEvent {
  id: string;
  title: string;
  country: string;
  currency: string;
  importance: EventImportance;
  impact: ImpactLevel;
  actual: string | null;
  forecast: string | null;
  previous: string | null;
  eventTime: string;
}