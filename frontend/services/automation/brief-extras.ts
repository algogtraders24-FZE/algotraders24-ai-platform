// services/automation/brief-extras.ts
// Pure helpers for the "extras" that Brief v2 adds around an agent brief: the
// gold price line, the macro-alignment line and today's high-impact events in
// IST with a countdown. No network, no DB: production wiring (delivery-deps.ts)
// fetches, these only format. Each extra is optional - when its data is
// unavailable it is simply left out, never estimated.

export interface DeliveryExtras {
  priceLine?: string;
  macroLine?: string;
  eventLines?: string[];
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** YYYY-MM-DD of an instant in Asia/Kolkata (fixed +05:30, no DST). */
export function istDateKey(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function istClock(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(11, 16);
}

export function countdown(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins <= 0) return "now";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h >= 24) return `in ${Math.floor(h / 24)}d ${h % 24}h`;
  return h > 0 ? `in ${h}h ${m}m` : `in ${m}m`;
}

export interface CalendarEventLike {
  title: string;
  currency: string;
  impact: string;
  isHoliday?: boolean;
  allDay?: boolean;
  eventTime: string;
  forecast?: string | null;
  previous?: string | null;
}

/** Today's (IST) high-impact, non-holiday events not yet past, soonest first, max `max` lines. */
export function formatEventLines(events: readonly CalendarEventLike[], now: Date, max = 4): string[] {
  const today = istDateKey(now);
  return events
    .filter((e) => e.impact === "high" && !e.isHoliday && !e.allDay)
    .map((e) => ({ e, t: new Date(e.eventTime) }))
    .filter(({ t }) => Number.isFinite(t.getTime()) && istDateKey(t) === today && t.getTime() >= now.getTime() - 15 * 60000)
    .sort((a, b) => a.t.getTime() - b.t.getTime())
    .slice(0, max)
    .map(({ e, t }) => {
      const detail = [e.forecast ? `forecast ${e.forecast}` : null, e.previous ? `previous ${e.previous}` : null].filter(Boolean).join(", ");
      return `${istClock(t)} IST (${countdown(t.getTime() - now.getTime())}) - ${e.currency} ${e.title}${detail ? ` [${detail}]` : ""}`;
    });
}

/** "Gold $4,166.15 (+0.40% today)" from a ready-made price (label + formatted text). */
export function formatPriceLine(price: { label: string; text: string; changePct: number } | null | undefined): string | undefined {
  if (!price) return undefined;
  const sign = price.changePct >= 0 ? "+" : "";
  return `${price.label} ${price.text} (${sign}${price.changePct.toFixed(2)}% today)`;
}
