// data/economic-events.ts
import type { EconomicEvent } from "@/types/economic-event";

export const economicEvents: EconomicEvent[] = [
  {
    id: "eco-001",
    title: "US CPI (YoY)",
    country: "United States",
    currency: "USD",
    importance: "high",
    impact: "high",
    actual: null,
    forecast: "2.9%",
    previous: "3.1%",
    eventTime: "2025-01-15T13:30:00Z",
  },
  {
    id: "eco-002",
    title: "ECB Interest Rate Decision",
    country: "Eurozone",
    currency: "EUR",
    importance: "high",
    impact: "high",
    actual: null,
    forecast: "4.00%",
    previous: "4.00%",
    eventTime: "2025-01-15T12:45:00Z",
  },
  {
    id: "eco-003",
    title: "UK Retail Sales (MoM)",
    country: "United Kingdom",
    currency: "GBP",
    importance: "medium",
    impact: "medium",
    actual: null,
    forecast: "0.3%",
    previous: "-0.2%",
    eventTime: "2025-01-15T07:00:00Z",
  },
];