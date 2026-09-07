// app/dashboard/calendar/page.tsx
// AN2 - the Economic Calendar. This is the feature AI News (AN1.7)
// explicitly deferred: "the old 'High Impact Economic Events' section is
// REMOVED entirely ... economic-calendar data needs its own future
// provider/contract/audit". This page is that, built on a real feed.
//
// Scope honesty (surfaced in the header, not hidden): the free
// FairEconomy/ForexFactory weekly feed carries the schedule, forecast and
// previous value - but NOT the released `actual`. The Actual column is
// rendered as an explicit "-" with a link to ForexFactory for the live
// number, rather than omitted (so the gap is visible) or faked.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import Alert from "@/components/ui/Alert";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import Skeleton from "@/components/ui/Skeleton";
import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/ui/Table";
import {
  CALENDAR_FILTER_CURRENCIES,
  ECONOMIC_IMPACTS,
  type EconomicCalendarResponse,
  type EconomicEvent,
  type EconomicImpact,
} from "@/types/economic-calendar";

const IMPACT_LABEL: Record<EconomicImpact, string> = { high: "High", medium: "Medium", low: "Low" };
const IMPACT_DOT: Record<EconomicImpact, string> = {
  high: "bg-danger",
  medium: "bg-warning",
  low: "bg-text-3",
};

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
}

function dayHeading(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: EconomicCalendarResponse };

export default function EconomicCalendarPage() {
  const [currency, setCurrency] = useState<string | null>(null);
  const [impact, setImpact] = useState<EconomicImpact | null>(null);
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    const params = new URLSearchParams({ week: "this" });
    if (currency) params.set("currency", currency);
    if (impact) params.set("impact", impact);
    try {
      const res = await fetch(`/api/private/intelligence/calendar?${params.toString()}`);
      const json = (await res.json().catch(() => null)) as
        | { status?: string; data?: EconomicCalendarResponse; error?: { message?: string } }
        | null;
      if (!res.ok || !json || json.status !== "ok" || !json.data) {
        setState({ status: "error", message: json?.error?.message || "Could not load the economic calendar." });
        return;
      }
      setState({ status: "ready", data: json.data });
    } catch {
      setState({ status: "error", message: "Network error - could not reach the calendar service." });
    }
  }, [currency, impact]);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => {
    if (state.status !== "ready") return [];
    const byDay = new Map<string, EconomicEvent[]>();
    for (const event of state.data.events) {
      // Bucket by the VIEWER'S local calendar day, not the UTC day - the
      // Time and heading are both rendered in local time, so a UTC-day key
      // would drop an event that is (say) 23:00 UTC Monday / 04:30 Tuesday
      // local into Monday's section at the bottom, out of time order.
      // en-CA gives a sortable YYYY-MM-DD in local time.
      const key = new Date(event.eventTime).toLocaleDateString("en-CA");
      const bucket = byDay.get(key);
      if (bucket) bucket.push(event);
      else byDay.set(key, [event]);
    }
    // events within each bucket are already in eventTime order (the service
    // sorts the feed); ordering the buckets by their local-day key keeps
    // the whole page chronological.
    return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [state]);

  return (
    <div className="min-h-screen bg-ink p-6 text-text">
      <div className="mx-auto max-w-6xl">
        <PageHeader
          eyebrow="Economic Calendar"
          title="Economic Calendar"
          description={
            <>
              This week&apos;s scheduled high-impact releases, with consensus forecast and prior value.{" "}
              <span className="text-text-3">
                Released &ldquo;actual&rdquo; figures aren&apos;t in the free feed yet - check{" "}
                <a href="https://www.forexfactory.com/calendar" target="_blank" rel="noreferrer" className="text-gold hover:underline">
                  ForexFactory
                </a>{" "}
                live at release time.
              </span>
            </>
          }
        />

        {state.status === "ready" && (
          <Alert
            tone={state.data.freshness.isStale ? "warning" : "info"}
            title={state.data.freshness.isStale ? "Calendar may be out of date" : "Updated"}
            className="mb-6"
          >
            {`Fetched from ${state.data.freshness.source} ${timeAgo(state.data.freshness.fetchedAt)}${
              state.data.freshness.isStale ? " - a forecast revision may not be reflected." : "."
            }`}
          </Alert>
        )}

        <div className="mb-3 flex flex-wrap gap-2">
          <FilterChip label="All currencies" active={currency === null} onClick={() => setCurrency(null)} />
          {CALENDAR_FILTER_CURRENCIES.map((c) => (
            <FilterChip key={c} label={c} active={currency === c} onClick={() => setCurrency(c)} />
          ))}
        </div>
        <div className="mb-6 flex flex-wrap gap-2">
          <FilterChip label="All impact" active={impact === null} onClick={() => setImpact(null)} />
          {ECONOMIC_IMPACTS.map((i) => (
            <FilterChip key={i} label={IMPACT_LABEL[i]} active={impact === i} onClick={() => setImpact(i)} />
          ))}
        </div>

        {state.status === "loading" && (
          <div className="space-y-2">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        )}

        {state.status === "error" && (
          <ErrorState
            title="Could not load the economic calendar"
            description={state.message}
            action={
              <Button variant="secondary" onClick={() => void load()}>
                Retry
              </Button>
            }
          />
        )}

        {state.status === "ready" && state.data.events.length === 0 && (
          <EmptyState title="No events match the current filters." description="Try a different currency or impact level above." />
        )}

        {state.status === "ready" && state.data.events.length > 0 && (
          <div className="space-y-6">
            {grouped.map(([day, events]) => (
              <section key={day}>
                <h2 className="mb-2 text-sm font-semibold text-text-2">{dayHeading(events[0].eventTime)}</h2>
                <Table>
                  <Thead>
                    <tr>
                      <Th className="w-20">Time</Th>
                      <Th className="w-16">Cur.</Th>
                      <Th className="w-24">Impact</Th>
                      <Th>Event</Th>
                      <Th className="w-20 text-right">Actual</Th>
                      <Th className="w-20 text-right">Forecast</Th>
                      <Th className="w-20 text-right">Previous</Th>
                    </tr>
                  </Thead>
                  <Tbody>
                    {events.map((event) => (
                      <Tr key={event.id}>
                        <Td className="whitespace-nowrap tabular-nums">{event.allDay ? "All day" : clockTime(event.eventTime)}</Td>
                        <Td className="font-medium text-text">{event.currency === "ALL" ? "-" : event.currency}</Td>
                        <Td>
                          <span className="inline-flex items-center gap-1.5">
                            <span className={`h-2 w-2 rounded-full ${IMPACT_DOT[event.impact]}`} aria-hidden />
                            <span className="text-xs text-text-3">{IMPACT_LABEL[event.impact]}</span>
                          </span>
                        </Td>
                        <Td className="text-text">
                          {event.title}
                          {event.isHoliday && <span className="ml-2 text-xs text-text-3">(holiday)</span>}
                        </Td>
                        <Td className="text-right tabular-nums text-text-3">{event.actual ?? "-"}</Td>
                        <Td className="text-right tabular-nums">{event.forecast ?? "-"}</Td>
                        <Td className="text-right tabular-nums text-text-3">{event.previous ?? "-"}</Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
        active ? "border-gold/40 bg-gold/15 text-gold" : "border-border text-text-2 hover:border-gold/40"
      }`}
    >
      {label}
    </button>
  );
}
