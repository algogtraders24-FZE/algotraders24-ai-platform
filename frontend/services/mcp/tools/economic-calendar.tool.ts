// services/mcp/tools/economic-calendar.tool.ts
// AT24 MCP v1 - tool: calendar.events. Thin adapter over the EXISTING AN2
// getEconomicCalendar() read path. The upstream aggregator is never named in
// the output (product call: only AT24's own source label is shown), and the
// released `actual` is never claimed (the free feed does not carry it).

import type { ToolDefinition } from "@/types/agent-framework";
import { contractOk, contractResult } from "@/types/agent-framework";
import type { ToolImplementation, ToolInputParseResult } from "@/services/agent-framework/tools/tool-implementation";
import { isRecord } from "@/services/agent-framework/tools/tool-implementation";
import { ECONOMIC_IMPACTS, isEconomicImpact, type EconomicImpact } from "@/types/economic-calendar";

interface CalendarToolInput {
  currencies?: string[];
  impacts?: EconomicImpact[];
}

interface CalendarToolEvent {
  title: string;
  currency: string;
  impact: EconomicImpact;
  eventTime: string;
  forecast: string | null;
  previous: string | null;
}

interface CalendarToolOutput {
  week: "this";
  events: CalendarToolEvent[];
  truncated: boolean;
  source: string;
  fetchedAt: string;
  isStale: boolean;
  note: string;
}

/** Hard cap so one call can never return an unbounded payload. */
export const CALENDAR_TOOL_MAX_EVENTS = 100;

const definition: ToolDefinition = {
  id: "calendar.events",
  name: "Economic Calendar",
  description:
    "This week's scheduled economic events (title, currency, impact, UTC time, forecast, previous), optionally filtered by currency and impact. Scheduled data only: released actual values are not available.",
  version: "1.0.0",
  category: "MARKET_DATA",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      currencies: { type: "array", items: { type: "string", minLength: 2, maxLength: 4 }, maxItems: 10 },
      impacts: { type: "array", items: { type: "string", enum: [...ECONOMIC_IMPACTS] }, maxItems: 3 },
    },
  },
  outputSchema: { type: "object" },
  requiredPermissions: ["CAN_READ_MARKET_DATA"],
  autonomyFloor: 0,
  creditCost: { model: "flat", credits: 1 },
  executionMode: "sync",
  evidence: { producesEvidence: false, evidenceTypes: [], provenanceProducer: "economic-calendar" },
  status: "active",
  wraps: "services/calendar/calendar.service.ts (getEconomicCalendar)",
};

function parseInput(raw: unknown): ToolInputParseResult<CalendarToolInput> {
  if (raw === undefined || raw === null) return { ok: true, value: {} };
  if (!isRecord(raw)) return { ok: false, violations: [{ path: "", message: "input must be an object." }] };
  for (const k of Object.keys(raw)) {
    if (k !== "currencies" && k !== "impacts") return { ok: false, violations: [{ path: k, message: "unknown field." }] };
  }
  const value: CalendarToolInput = {};
  if (raw.currencies !== undefined) {
    if (!Array.isArray(raw.currencies) || raw.currencies.length > 10 || !raw.currencies.every((c) => typeof c === "string" && /^[A-Za-z]{2,4}$/.test(c))) {
      return { ok: false, violations: [{ path: "currencies", message: "currencies must be up to 10 codes of 2-4 letters." }] };
    }
    value.currencies = raw.currencies.map((c: string) => c.toUpperCase());
  }
  if (raw.impacts !== undefined) {
    if (!Array.isArray(raw.impacts) || raw.impacts.length > 3 || !raw.impacts.every((i) => typeof i === "string" && isEconomicImpact(i))) {
      return { ok: false, violations: [{ path: "impacts", message: "impacts must be a subset of high|medium|low." }] };
    }
    value.impacts = raw.impacts as EconomicImpact[];
  }
  return { ok: true, value };
}

function checkOutput(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.events)) return contractResult([{ path: "events", message: "output.events must be an array." }]);
  if (typeof value.source !== "string") return contractResult([{ path: "source", message: "output.source must be a string." }]);
  return contractOk();
}

export const economicCalendarTool: ToolImplementation<CalendarToolInput, CalendarToolOutput> = {
  definition,
  parseInput,
  checkOutput,
  async handler(input) {
    // Dynamic import: the calendar service is `server-only`, so it is loaded
    // lazily inside the handler (keeps this module importable from scripts).
    const { getEconomicCalendar } = await import("@/services/calendar/calendar.service");
    const res = await getEconomicCalendar({ week: "this", currencies: input.currencies, impacts: input.impacts });
    const sorted = [...res.events].sort((a, b) => a.eventTime.localeCompare(b.eventTime));
    const events = sorted.slice(0, CALENDAR_TOOL_MAX_EVENTS).map((e) => ({
      title: e.title,
      currency: e.currency,
      impact: e.impact,
      eventTime: e.eventTime,
      forecast: e.forecast,
      previous: e.previous,
    }));
    return {
      output: {
        week: "this",
        events,
        truncated: sorted.length > events.length,
        source: res.freshness.source,
        fetchedAt: res.freshness.fetchedAt,
        isStale: res.freshness.isStale,
        note: "Scheduled events only; released actual values are not available from this source.",
      },
      evidence: [],
    };
  },
};
